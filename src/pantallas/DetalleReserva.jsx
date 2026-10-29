import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { fechaLarga } from '../lib/fechas'
import { Aviso, Cargando } from '../componentes/ui'

const NOTAS = {
  con_reserva: 'Ya tiene el máximo de reservas',
  muy_cerca: 'Tiene otra reserva muy cerca de este horario',
  sin_carnet: 'Sin carnet de tenis vigente',
}
const BOTON = 'min-h-11 rounded-lg bg-verde px-4 text-sm font-bold text-white hover:bg-verde-oscuro disabled:opacity-60'
const BOTON_2 = 'min-h-11 rounded-lg border-[1.5px] border-borde bg-white px-3 text-sm font-bold text-tinta hover:border-verde disabled:opacity-60'
const ENTRADA = 'h-11 rounded-xl border-[1.5px] border-borde bg-white px-3 text-base outline-none focus:border-verde'

// Detalle de una reserva para la Capitanía: cambiar de cancha, reemplazar a un jugador o cancelarla.
// Cada cambio les avisa por mail a los jugadores y se ve en "Mis reservas".
export default function DetalleReserva({ sesion, id, onCerrar, onCambio, onError }) {
  const [r, setR] = useState(null)
  const [error, setError] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const [modo, setModo] = useState(null) // null | 'cancha' | { reemplazar: jugador }

  const manejar = useCallback((e) => (e.codigo === 'SESION' ? onError(e) : setError(e.message)), [onError])
  const cargar = useCallback(() => api.capitaniaReserva(sesion.token, id).then(setR).catch(manejar), [sesion.token, id, manejar])
  useEffect(() => { cargar() }, [cargar])

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onCerrar() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onCerrar])

  async function hacer(fn, texto, cerrar = false) {
    setTrabajando(true)
    setError('')
    try {
      await fn()
      setModo(null)
      onCambio(texto, cerrar)
      if (!cerrar) await cargar()
    } catch (e) { manejar(e); cargar() } finally { setTrabajando(false) }
  }

  function cancelar() {
    if (!window.confirm(`Cancha ${r.cancha} · ${r.hora_inicio}\n\n¿Cancelar esta reserva? Les avisamos por mail a los jugadores.`)) return
    hacer(() => api.cancelar(sesion.token, r.id), `Reserva de la cancha ${r.cancha} cancelada.`, true)
  }

  const editable = r && r.estado === 'activa' && !r.pasada

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-[rgba(20,33,26,0.45)] p-0 sm:items-center sm:p-6"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="detalle-titulo"
        className="flex max-h-[92dvh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 id="detalle-titulo" className="font-display text-2xl font-semibold">
              {r ? `Cancha ${r.cancha} · ${r.hora_inicio} a ${r.hora_fin}` : 'Reserva'}
            </h2>
            {r && <span className="text-[14px] text-gris">{fechaLarga(r.fecha)} · {r.tipo === 'single' ? 'Single' : 'Dobles'}</span>}
          </div>
          <button onClick={onCerrar} aria-label="Cerrar" className="flex size-11 shrink-0 items-center justify-center rounded-lg text-gris hover:bg-apagado">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        {!r && !error && <Cargando />}
        {error && <Aviso tipo="error">{error}</Aviso>}

        {r && (
          <>
            {!editable && (
              <Aviso tipo="alerta">{r.estado !== 'activa' ? 'Esta reserva ya no está activa.' : 'Este partido ya terminó: no se puede modificar.'}</Aviso>
            )}
            {r.modificada && (
              <span className="text-[13px] text-gris">Modificada por {r.modificada_por ?? 'la Capitanía'}.</span>
            )}

            <section className="flex flex-col gap-2">
              <span className="text-[13px] font-bold text-gris">Jugadores</span>
              <ul className="flex flex-col rounded-xl border border-borde">
                {r.jugadores.map((j) => (
                  <li key={j.nro} className="flex items-center justify-between gap-3 border-b border-borde px-3 py-2 last:border-0">
                    <span className="flex flex-col">
                      <span className="text-[15px] font-bold">{j.nombre}</span>
                      <span className="text-[13px] text-gris">Socio {j.nro}{j.titular ? ' · titular' : ''}</span>
                    </span>
                    {editable && (
                      <button onClick={() => { setError(''); setModo({ reemplazar: j }) }} disabled={trabajando} className={BOTON_2}>
                        Reemplazar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            {r.invitado && (
              <section className="flex flex-col gap-2">
                <span className="text-[13px] font-bold text-gris">Invitado no socio</span>
                <div className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${r.invitado.pagado ? 'border-borde' : 'border-[#f2d3a6] bg-[#fff4e5]'}`}>
                  <span className="flex flex-col">
                    <span className="text-[15px] font-bold">{r.invitado.nombre}</span>
                    <span className="text-[13px] text-gris">
                      DNI {r.invitado.dni} · {r.invitado.veces_mes === 1 ? 'primera vez este mes' : `${r.invitado.veces_mes} veces este mes`}
                    </span>
                    <span className={`text-[13px] font-bold ${r.invitado.pagado ? 'text-verde' : 'text-[#8a4b00]'}`}>
                      {r.invitado.pagado ? 'Pagó el día' : 'A cobrar'}
                    </span>
                  </span>
                  {r.estado === 'activa' && (
                    <button disabled={trabajando} className={r.invitado.pagado ? BOTON_2 : BOTON}
                      onClick={() => hacer(() => api.capitaniaInvitadoPago(sesion.token, r.id, !r.invitado.pagado),
                        r.invitado.pagado ? `${r.invitado.nombre}: se marcó como no pagado.` : `${r.invitado.nombre} pagó el día.`)}>
                      {r.invitado.pagado ? 'Deshacer' : 'Marcar que pagó'}
                    </button>
                  )}
                </div>
              </section>
            )}

            {editable && modo?.reemplazar && (
              <Reemplazo sesion={sesion} r={r} sale={modo.reemplazar} trabajando={trabajando} onError={manejar}
                onCancelar={() => setModo(null)}
                onElegir={(entra, motivo) => hacer(
                  () => api.capitaniaReemplazar(sesion.token, r.id, modo.reemplazar.nro, entra.nro, motivo),
                  `Cancha ${r.cancha} · ${r.hora_inicio}: entra ${entra.nombre} en lugar de ${modo.reemplazar.nombre}. Les avisamos por mail.`)} />
            )}

            {editable && modo === 'cancha' && (
              <MoverCancha r={r} trabajando={trabajando} onCancelar={() => setModo(null)}
                onMover={(cancha, motivo) => hacer(
                  () => api.capitaniaMover(sesion.token, r.id, cancha, motivo),
                  `La reserva de las ${r.hora_inicio} pasó de la cancha ${r.cancha} a la ${cancha}. Les avisamos por mail.`)} />
            )}

            {editable && !modo && (
              <div className="flex flex-wrap gap-2 border-t border-borde pt-4">
                <button onClick={() => { setError(''); setModo('cancha') }} disabled={trabajando} className={BOTON}>Cambiar de cancha</button>
                <button onClick={cancelar} disabled={trabajando}
                  className="min-h-11 rounded-lg border-[1.5px] border-error px-3 text-sm font-bold text-error hover:bg-[#fdf3f2] disabled:opacity-60">
                  Cancelar reserva
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function MoverCancha({ r, trabajando, onCancelar, onMover }) {
  const [cancha, setCancha] = useState(null)
  const [motivo, setMotivo] = useState('')
  return (
    <section className="flex flex-col gap-3 rounded-xl bg-fondo p-3">
      <span className="text-[15px] font-bold">Pasar a otra cancha, mismo horario</span>
      {r.canchas_libres.length === 0 ? (
        <p className="text-[14px] text-gris">No hay otras canchas libres de {r.hora_inicio} a {r.hora_fin}.</p>
      ) : (
        <div className="grid grid-cols-5 gap-1.5">
          {r.canchas_libres.map((n) => (
            <button key={n} onClick={() => setCancha(n)} aria-pressed={cancha === n}
              className={`min-h-11 rounded-lg border-[1.5px] text-sm font-bold ${cancha === n ? 'border-verde bg-verde text-white' : 'border-borde bg-white text-tinta hover:border-verde'}`}>
              {n}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="mover-motivo" className="text-[13px] font-bold">Motivo (opcional, va en el mail)</label>
        <input id="mover-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. Mantenimiento" className={ENTRADA} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => onMover(cancha, motivo.trim())} disabled={!cancha || trabajando} className={BOTON}>
          {trabajando ? 'Moviendo…' : cancha ? `Pasar a la cancha ${cancha}` : 'Elegí una cancha'}
        </button>
        <button onClick={onCancelar} disabled={trabajando} className={BOTON_2}>Volver</button>
      </div>
    </section>
  )
}

function Reemplazo({ sesion, r, sale, trabajando, onError, onCancelar, onElegir }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [entra, setEntra] = useState(null)
  const [motivo, setMotivo] = useState('')
  const actuales = new Set(r.jugadores.map((j) => j.nro))

  useEffect(() => {
    const texto = q.trim()
    if (texto.length < 2) { setRes([]); return }
    setBuscando(true)
    let vigente = true
    const t = setTimeout(() => {
      api.buscarSocios(sesion.token, texto, r.inicio, r.fin)
        .then((x) => vigente && setRes(x.filter((s) => !actuales.has(s.nro))))
        .catch(onError)
        .finally(() => vigente && setBuscando(false))
    }, 300)
    return () => { vigente = false; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, sesion.token, r.id])

  return (
    <section className="flex flex-col gap-3 rounded-xl bg-fondo p-3">
      <span className="text-[15px] font-bold">Reemplazar a {sale.nombre}</span>
      {entra ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border-[1.5px] border-verde bg-white px-3 py-2">
          <span className="flex flex-col">
            <span className="text-[15px] font-bold">{entra.nombre}</span>
            <span className="text-[13px] text-gris">Socio {entra.nro}{sale.titular ? ' · queda como titular' : ''}</span>
          </span>
          <button onClick={() => setEntra(null)} className="min-h-11 px-2 text-sm font-bold text-verde">Cambiar</button>
        </div>
      ) : (
        <>
          <input aria-label="Buscar socio que entra" placeholder="Nombre, apellido o número de socio" value={q}
            onChange={(e) => setQ(e.target.value)} autoComplete="off" autoFocus className={ENTRADA} />
          {buscando && <span className="text-[13px] text-gris">Buscando…</span>}
          {!buscando && q.trim().length >= 2 && res.length === 0 && <span className="text-[14px] text-gris">No encontramos socios con esa búsqueda.</span>}
          {res.length > 0 && (
            <ul className="flex max-h-56 flex-col overflow-y-auto rounded-xl border border-borde bg-white">
              {res.map((s) => {
                const puede = s.estado === 'ok'
                return (
                  <li key={s.nro} className="border-b border-borde last:border-0">
                    <button onClick={() => puede && setEntra(s)} disabled={!puede}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left ${puede ? 'hover:bg-verde-claro' : 'text-gris'}`}>
                      <span className="flex flex-col">
                        <span className={`text-[15px] font-bold ${puede ? '' : 'line-through decoration-1'}`}>{s.nombre}</span>
                        <span className={`text-[13px] ${puede ? 'text-gris' : 'text-[#9a3412]'}`}>Socio {s.nro}{puede ? '' : ` · ${NOTAS[s.estado] ?? 'No disponible'}`}</span>
                      </span>
                      {puede && <span className="text-sm font-bold text-verde">Elegir</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="reemplazo-motivo" className="text-[13px] font-bold">Motivo (opcional, va en el mail)</label>
        <input id="reemplazo-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. Lesión" className={ENTRADA} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => onElegir(entra, motivo.trim())} disabled={!entra || trabajando} className={BOTON}>
          {trabajando ? 'Guardando…' : 'Confirmar reemplazo'}
        </button>
        <button onClick={onCancelar} disabled={trabajando} className={BOTON_2}>Volver</button>
      </div>
    </section>
  )
}
