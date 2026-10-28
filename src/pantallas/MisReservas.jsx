import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { fechaCorta } from '../lib/fechas'
import { Aviso, BotonPrincipal, Cargando, Titulo } from '../componentes/ui'
import MiMail from '../componentes/MiMail'

// Avisos de cancelación que el socio ya vio (se guardan en el dispositivo)
const CLAVE_VISTAS = 'csf-tenis-canceladas-vistas'
function leerVistas() {
  try { return JSON.parse(localStorage.getItem(CLAVE_VISTAS)) || [] } catch { return [] }
}

export default function MisReservas({ sesion, onReservar, onError }) {
  const [reservas, setReservas] = useState(null)
  const [error, setError] = useState('')
  const [cancelando, setCancelando] = useState(null)
  const [vistas, setVistas] = useState(leerVistas)

  function marcarVista(id) {
    const nuevas = [...vistas, id].slice(-50)
    setVistas(nuevas)
    try { localStorage.setItem(CLAVE_VISTAS, JSON.stringify(nuevas)) } catch { /* sin almacenamiento */ }
  }

  function cargar() {
    api.misReservas(sesion.token)
      .then(setReservas)
      .catch((e) => (e.codigo === 'SESION' ? onError(e) : setError(e.message)))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(cargar, [sesion.token])

  async function cancelar(r) {
    if (!window.confirm(`¿Cancelar la reserva del ${fechaCorta(r.fecha)} a las ${r.hora_inicio} en la cancha ${r.cancha}?`)) return
    setCancelando(r.id)
    setError('')
    try {
      await api.cancelar(sesion.token, r.id)
      cargar()
    } catch (e) {
      if (e.codigo === 'SESION') onError(e)
      else setError(e.message)
    } finally {
      setCancelando(null)
    }
  }

  const activas = reservas?.filter((r) => r.estado !== 'cancelada') ?? []
  const canceladas = reservas?.filter((r) => r.estado === 'cancelada' && !vistas.includes(r.id)) ?? []

  return (
    <div className="flex flex-col gap-4">
      <Titulo>Mis reservas</Titulo>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {!reservas && !error && <Cargando />}

      {reservas && activas.length === 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-borde bg-white p-5">
          <span className="text-base">No tenés reservas activas.</span>
          <BotonPrincipal onClick={onReservar}>Reservar una cancha</BotonPrincipal>
        </div>
      )}

      {activas.map((r) => {
        const otros = r.jugadores.filter((j) => j.nro !== sesion.nro).map((j) => j.nombre)
        const titular = r.jugadores.find((j) => j.titular)
        return (
          <article key={r.id} className="flex flex-col gap-3 rounded-2xl border border-borde bg-white p-4">
            <div className="flex items-center justify-between">
              <span className="inline-flex min-h-6 items-center rounded-full bg-verde-claro px-2.5 text-xs font-bold tracking-wider text-verde-oscuro">ACTIVA</span>
              <span className="text-sm text-gris">{r.tipo === 'single' ? 'Single' : 'Dobles'}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <strong className="font-display text-2xl font-semibold">
                {fechaCorta(r.fecha)} · {r.hora_inicio} a {r.hora_fin}
              </strong>
              <span className="text-[15px] text-gris">Cancha {r.cancha} · con {otros.join(', ')}</span>
            </div>
            {r.soy_titular ? (
              <button
                onClick={() => cancelar(r)}
                disabled={cancelando === r.id}
                className="h-11 rounded-xl border-[1.5px] border-error bg-white text-[15px] font-bold text-error disabled:opacity-60"
              >
                {cancelando === r.id ? 'Cancelando…' : 'Cancelar reserva'}
              </button>
            ) : (
              <p className="text-[13px] text-gris">La reservó {titular?.nombre}. Si no podés ir, pedile que la cancele.</p>
            )}
          </article>
        )
      })}

      {/* Reservas que me cancelaron otros (Capitanía o el titular), para que me entere */}
      {canceladas.map((r) => {
        const titular = r.jugadores.find((j) => j.titular)
        const quien = r.cancelada_por_capitania
          ? `La canceló la Capitanía${r.motivo_cancelacion && r.motivo_cancelacion !== 'Cancelada por la Capitanía' ? `: ${r.motivo_cancelacion}` : ''}.`
          : `La canceló ${titular?.nombre ?? 'el titular'}.`
        return (
          <article key={r.id} className="flex flex-col gap-2 rounded-2xl border border-[#f5c2bd] bg-[#fdf3f2] p-4">
            <span className="inline-flex min-h-6 items-center self-start rounded-full bg-[#fbe0dd] px-2.5 text-xs font-bold tracking-wider text-error">CANCELADA</span>
            <strong className="font-display text-xl font-semibold text-gris line-through decoration-1">
              {fechaCorta(r.fecha)} · {r.hora_inicio} a {r.hora_fin} · Cancha {r.cancha}
            </strong>
            <span className="text-[15px] text-tinta">{quien} Podés reservar otro horario.</span>
            <button onClick={() => marcarVista(r.id)} className="min-h-11 self-start font-bold text-error underline">
              Entendido
            </button>
          </article>
        )
      })}

      <MiMail sesion={sesion} modo="ficha" onError={onError} />

      <p className="text-[13px] leading-snug text-gris">
        Podés tener hasta 2 reservas activas, como titular o como jugador invitado, con al menos 1 hora entre una y otra.
      </p>
    </div>
  )
}
