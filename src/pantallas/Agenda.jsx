import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { etiquetaDia, fechaCorta, fechaLarga, momento } from '../lib/fechas'
import { Aviso, Cargando, Etiqueta, Titulo } from '../componentes/ui'

export default function Agenda({ sesion, seleccion, setSeleccion, onElegirHorario, onVerMis, onError }) {
  const [dias, setDias] = useState(null)
  const [disp, setDisp] = useState(null)
  const [error, setError] = useState('')
  const { fecha, tipo } = seleccion

  // Días disponibles (hoy + anticipación)
  useEffect(() => {
    api.dias(sesion.token)
      .then((d) => {
        setDias(d)
        if (!fecha || !d.some((x) => x.fecha === fecha)) setSeleccion({ fecha: d[0].fecha, tipo })
      })
      .catch(onError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sesion.token])

  // Disponibilidad del día y tipo elegidos
  useEffect(() => {
    if (!fecha) return
    let vigente = true
    setDisp(null)
    setError('')
    api.disponibilidad(sesion.token, fecha, tipo)
      .then((d) => vigente && setDisp(d))
      .catch((e) => {
        if (!vigente) return
        if (e.codigo === 'SESION') onError(e)
        else setError(e.message)
      })
    return () => { vigente = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sesion.token, fecha, tipo])

  const bloqueadoPorReserva = disp?.mi_reserva_activa

  return (
    <div className="flex flex-col gap-5">
      <Titulo>Reservá tu cancha</Titulo>

      {bloqueadoPorReserva && (
        <Aviso tipo="alerta">
          <strong className="block">
            {disp.max_reservas ? `Ya tenés ${disp.max_reservas} reservas activas, el máximo` : 'Ya tenés una reserva activa'}
          </strong>
          <button onClick={onVerMis} className="min-h-11 font-bold underline">Ver mis reservas</button>
        </Aviso>
      )}

      <div className="flex flex-col gap-2">
        <Etiqueta>Día</Etiqueta>
        {!dias ? <Cargando /> : (
          <div className="flex gap-2">
            {dias.map((d, i) => {
              const activo = d.fecha === fecha
              return (
                <button
                  key={d.fecha}
                  onClick={() => setSeleccion({ fecha: d.fecha, tipo })}
                  aria-pressed={activo}
                  className={`flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl border-[1.5px] px-1 py-2 transition ${
                    activo
                      ? 'border-verde bg-verde text-white'
                      : d.habilitado
                        ? 'border-borde bg-white text-tinta'
                        : 'border-dashed border-borde bg-white text-gris'
                  }`}
                >
                  <span className="text-[15px] font-bold">{etiquetaDia(d.fecha, i)}</span>
                  <span className="text-xs opacity-90">{d.habilitado ? fechaCorta(d.fecha) : 'Todavía no'}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Etiqueta>Tipo de partido</Etiqueta>
        <div className="flex gap-1 rounded-xl bg-apagado p-1">
          {[['single', 'Single · 60 min'], ['dobles', 'Dobles · 90 min']].map(([valor, texto]) => (
            <button
              key={valor}
              onClick={() => setSeleccion({ fecha, tipo: valor })}
              aria-pressed={tipo === valor}
              className={`min-h-11 flex-1 rounded-lg text-[15px] font-bold transition ${
                tipo === valor ? 'bg-white text-tinta shadow-sm' : 'text-gris'
              }`}
            >
              {texto}
            </button>
          ))}
        </div>
      </div>

      {error && <Aviso tipo="error">{error}</Aviso>}
      {!disp && !error && fecha && <Cargando texto="Buscando canchas libres…" />}

      {disp && !disp.habilitado && (
        <div className="flex gap-3 rounded-xl border border-dashed border-borde bg-white p-4 text-[15px] leading-snug">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="mt-0.5 shrink-0 text-azul" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
          </svg>
          <span>
            Los turnos del <strong>{fechaLarga(disp.fecha)}</strong> se habilitan el{' '}
            <strong>{momento(disp.habilita_en)}</strong>.
          </span>
        </div>
      )}

      {disp?.habilitado && disp.slots.length === 0 && (
        <div className="rounded-xl border border-borde bg-white p-4 text-[15px] text-gris">
          No quedan turnos para este día.
        </div>
      )}

      {disp?.habilitado && disp.slots.length > 0 && (
        <div className="flex flex-col gap-2">
          <Etiqueta>Horario de inicio</Etiqueta>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {disp.slots.map((s) => {
              const n = s.libres.length
              const cerca = !!s.cerca_de_otra
              const deshabilitado = n === 0 || bloqueadoPorReserva || cerca
              return (
                <button
                  key={s.hora}
                  disabled={deshabilitado}
                  onClick={() => onElegirHorario(s, disp)}
                  className={`flex min-h-14 flex-col items-center justify-center gap-px rounded-xl border-[1.5px] px-1 py-1.5 transition ${
                    deshabilitado
                      ? 'border-apagado bg-apagado text-gris'
                      : 'border-borde bg-white text-tinta hover:border-verde'
                  }`}
                >
                  <span className="text-[17px] font-bold">{s.hora}</span>
                  <span className={`text-xs font-bold ${deshabilitado ? 'text-gris' : 'text-verde'}`}>
                    {n === 0 ? 'Completo' : n === 1 ? '1 libre' : `${n} libres`}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <p className="text-[13px] text-gris">Luz: si la necesitás, se abona con ficha en la cancha.</p>
    </div>
  )
}
