import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { fechaCorta } from '../lib/fechas'
import { Aviso, BotonPrincipal, Cargando, Titulo } from '../componentes/ui'

export default function MisReservas({ sesion, onReservar, onError }) {
  const [reservas, setReservas] = useState(null)
  const [error, setError] = useState('')
  const [cancelando, setCancelando] = useState(null)

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

  return (
    <div className="flex flex-col gap-4">
      <Titulo>Mis reservas</Titulo>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {!reservas && !error && <Cargando />}

      {reservas?.length === 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-borde bg-white p-5">
          <span className="text-base">No tenés reservas activas.</span>
          <BotonPrincipal onClick={onReservar}>Reservar una cancha</BotonPrincipal>
        </div>
      )}

      {reservas?.map((r) => {
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

      <p className="text-[13px] leading-snug text-gris">
        Podés tener una sola reserva activa, ya sea como titular o como jugador invitado por otro socio.
      </p>
    </div>
  )
}
