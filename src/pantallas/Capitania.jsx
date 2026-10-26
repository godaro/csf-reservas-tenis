import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { fechaCorta, fechaLarga, hoy, sumarDias } from '../lib/fechas'
import { Aviso, Cargando, Titulo } from '../componentes/ui'

const MOTIVOS = ['Escuela de Tenis', 'Clases', 'Interclubes', 'Torneo interno', 'Mantenimiento', 'Lluvia']
const HORAS = Array.from({ length: 29 }, (_, i) => {
  const m = 8 * 60 + i * 30
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${m % 60 ? '30' : '00'}`
})

const COLOR = {
  libre: 'bg-white border-borde',
  reservada: 'bg-[#9ccbae] border-[#9ccbae] hover:brightness-95',
  bloqueada: 'bg-azul border-azul',
}

export default function Capitania({ sesion, onError }) {
  const [fecha, setFecha] = useState(hoy())
  const [panel, setPanel] = useState(null)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  const [canchas, setCanchas] = useState([])
  const [desde, setDesde] = useState('09:00')
  const [hasta, setHasta] = useState('12:00')
  const [motivo, setMotivo] = useState(MOTIVOS[0])
  const [semanal, setSemanal] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [conflicto, setConflicto] = useState(null) // { datos, afectadas: [...] }
  // Si cambian los datos del formulario, el aviso anterior ya no aplica
  useEffect(() => { setConflicto(null) }, [canchas, desde, hasta, motivo, semanal, fecha])

  const manejar = useCallback((e) => (e.codigo === 'SESION' ? onError(e) : setError(e.message)), [onError])

  // Solo se muestra la respuesta del último pedido (evita que un día viejo pise al nuevo)
  const ultimo = useRef(0)
  const cargar = useCallback(() => {
    const id = ++ultimo.current
    setError('')
    api.panelDia(sesion.token, fecha)
      .then((p) => id === ultimo.current && setPanel(p))
      .catch((e) => id === ultimo.current && manejar(e))
  }, [sesion.token, fecha, manejar])

  useEffect(() => { cargar() }, [cargar])
  const panelVisible = panel?.fecha === fecha ? panel : null

  const alternarCancha = (n) =>
    setCanchas((c) => (c.includes(n) ? c.filter((x) => x !== n) : [...c, n].sort((a, b) => a - b)))

  // Paso 1: revisar si el bloqueo pisa reservas. Si no pisa nada, se crea directo.
  async function bloquear(e) {
    e.preventDefault()
    setGuardando(true)
    setError('')
    setOk('')
    setConflicto(null)
    const datos = { canchas, fecha, desde, hasta, motivo, semanal }
    try {
      const afectadas = await api.previsualizarBloqueo(sesion.token, datos)
      if (afectadas.length > 0) setConflicto({ datos, afectadas })
      else await crear(datos, false)
    } catch (err) {
      manejar(err)
    } finally {
      setGuardando(false)
    }
  }

  // Paso 2: crear el bloqueo (y, si se confirmó, cancelar las reservas que pisa)
  async function crear(datos, cancelarReservas) {
    setGuardando(true)
    try {
      const r = await api.crearBloqueo(sesion.token, datos, cancelarReservas)
      setOk(r.reservas_canceladas > 0
        ? `Bloqueo creado. Se ${r.reservas_canceladas === 1 ? 'canceló 1 reserva' : `cancelaron ${r.reservas_canceladas} reservas`}; los socios lo ven en "Mis reservas".`
        : 'Bloqueo creado.')
      setConflicto(null)
      setCanchas([])
      cargar()
    } catch (err) {
      // Si entre el aviso y la confirmación alguien reservó, volvemos a mostrar la lista actualizada
      if (err.codigo === 'CONFLICTO') {
        const afectadas = await api.previsualizarBloqueo(sesion.token, datos).catch(() => [])
        setConflicto({ datos, afectadas })
      } else manejar(err)
    } finally {
      setGuardando(false)
    }
  }

  async function borrar(b) {
    if (!window.confirm(`¿Borrar el bloqueo "${b.motivo}" de la cancha ${b.cancha}${b.semanal ? ' (todas las semanas)' : ''}?`)) return
    try { await api.borrarBloqueo(sesion.token, b.id); cargar() } catch (e) { manejar(e) }
  }

  async function cancelarReserva(celda, cancha, horaTxt) {
    if (!window.confirm(`Cancha ${cancha} · ${horaTxt}\n${celda.detalle}\n\n¿Cancelar esta reserva?`)) return
    try { await api.cancelar(sesion.token, celda.reserva_id); cargar() } catch (e) { manejar(e) }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Titulo sub={fechaLarga(fecha)}>Panel de Capitanía</Titulo>
        <div className="flex items-center gap-2" role="group" aria-label="Elegir día">
          <button type="button" onClick={() => setFecha(sumarDias(fecha, -1))} aria-label="Día anterior"
            className="flex size-11 items-center justify-center rounded-xl border-[1.5px] border-borde bg-white text-tinta hover:border-verde">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
          </button>
          <button type="button" onClick={() => setFecha(hoy())} disabled={fecha === hoy()}
            className="h-11 rounded-xl border-[1.5px] border-verde bg-white px-4 font-bold text-verde hover:bg-verde-claro disabled:border-borde disabled:text-gris disabled:hover:bg-white">
            Hoy
          </button>
          <button type="button" onClick={() => setFecha(sumarDias(fecha, 1))} aria-label="Día siguiente"
            className="flex size-11 items-center justify-center rounded-xl border-[1.5px] border-borde bg-white text-tinta hover:border-verde">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </button>
          <input type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} aria-label="Ir a una fecha"
            className="h-11 rounded-xl border-[1.5px] border-borde bg-white px-3 text-base" />
        </div>
      </div>

      {error && <Aviso tipo="error">{error}</Aviso>}
      {ok && <Aviso>{ok}</Aviso>}

      <div className="flex flex-wrap gap-4 text-[13px] text-gris">
        <span className="inline-flex items-center gap-1.5"><span className="size-3.5 rounded border border-borde bg-white" />Libre</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3.5 rounded bg-[#9ccbae]" />Reservada (tocá para cancelar)</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3.5 rounded bg-azul" />Bloqueada</span>
      </div>

      {!panelVisible ? <Cargando /> : (
        <div className="overflow-x-auto rounded-2xl border border-borde bg-white p-3">
          <div className="grid gap-0.5" style={{ gridTemplateColumns: `76px repeat(${panelVisible.horas.length}, minmax(24px, 1fr))`, minWidth: 820 }}>
            <span />
            {panelVisible.horas.map((h, i) => (
              <span key={h} className="whitespace-nowrap pb-1 text-[11px] font-bold text-gris">{i % 2 === 0 ? h : ''}</span>
            ))}
            {panelVisible.filas.map((f) => (
              <Fila key={f.cancha} fila={f} horas={panelVisible.horas} onReservada={cancelarReserva} />
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <form onSubmit={bloquear} className="flex flex-col gap-3 rounded-2xl border border-borde bg-white p-4">
          <h2 className="text-lg font-bold">Bloquear canchas · {fechaLarga(fecha)}</h2>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-[13px] font-bold">Canchas</legend>
            <div className="grid grid-cols-5 gap-1.5">
              {Array.from({ length: 15 }, (_, i) => i + 1).map((n) => (
                <button type="button" key={n} onClick={() => alternarCancha(n)} aria-pressed={canchas.includes(n)}
                  className={`min-h-11 rounded-lg border-[1.5px] font-bold ${canchas.includes(n) ? 'border-azul bg-azul text-white' : 'border-borde bg-white'}`}>
                  {n}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="flex gap-3">
            <Selector id="desde" label="Desde" valor={desde} setValor={setDesde} opciones={HORAS.slice(0, -1)} />
            <Selector id="hasta" label="Hasta" valor={hasta} setValor={setHasta} opciones={HORAS.slice(1)} />
          </div>
          <Selector id="motivo" label="Motivo" valor={motivo} setValor={setMotivo} opciones={MOTIVOS} />
          <label className="flex min-h-8 items-center gap-2 text-[15px]">
            <input type="checkbox" checked={semanal} onChange={(e) => setSemanal(e.target.checked)} className="size-4.5 accent-azul" />
            Repetir todas las semanas (mismo día y horario)
          </label>
          {conflicto && (
            <div role="alert" className="flex flex-col gap-3 rounded-xl border border-[#f2d3a6] bg-[#fff4e5] p-3.5 text-[#4a3a22]">
              <strong className="text-[15px]">
                Este bloqueo pisa {conflicto.afectadas.length === 1 ? '1 reserva' : `${conflicto.afectadas.length} reservas`} de socios:
              </strong>
              <ul className="flex flex-col gap-1.5 text-[14px]">
                {conflicto.afectadas.map((a) => (
                  <li key={a.id}>
                    <strong>Cancha {a.cancha}</strong> · {fechaCorta(a.fecha)} · {a.hora_inicio} a {a.hora_fin} · {a.jugadores}
                  </li>
                ))}
              </ul>
              <p className="text-[13px]">Si seguís, esas reservas se cancelan y los socios lo ven en “Mis reservas” con el motivo.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={guardando} onClick={() => crear(conflicto.datos, true)}
                  className="min-h-11 rounded-lg bg-error px-4 font-bold text-white disabled:opacity-60">
                  {guardando ? 'Guardando…' : `Bloquear y cancelar ${conflicto.afectadas.length === 1 ? 'la reserva' : 'las reservas'}`}
                </button>
                <button type="button" onClick={() => setConflicto(null)} className="min-h-11 rounded-lg px-4 font-bold text-[#8a4b00]">
                  Volver
                </button>
              </div>
            </div>
          )}
          <button disabled={guardando || canchas.length === 0 || !!conflicto}
            className="h-12 rounded-xl bg-azul font-bold text-white disabled:bg-apagado disabled:text-gris">
            {guardando ? 'Guardando…' : canchas.length === 0 ? 'Elegí al menos una cancha' : 'Bloquear franja'}
          </button>
        </form>

        <div className="flex flex-col gap-2 rounded-2xl border border-borde bg-white p-4">
          <h2 className="text-lg font-bold">Bloqueos del día</h2>
          {panelVisible?.bloqueos.length === 0 && <p className="text-[15px] text-gris">Sin bloqueos para este día.</p>}
          {panelVisible?.bloqueos.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-3 rounded-xl bg-azul-claro px-3 py-2">
              <span className="flex flex-col">
                <strong className="text-azul">{b.motivo} · Cancha {b.cancha}</strong>
                <span className="text-[13px] text-azul">{b.desde} a {b.hasta}{b.semanal ? ' · todas las semanas' : ''}</span>
              </span>
              <button onClick={() => borrar(b)} className="min-h-11 px-2 text-sm font-bold text-error">Borrar</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Fila({ fila, horas, onReservada }) {
  return (
    <>
      <span className="flex h-8 items-center text-[13px] font-bold">Cancha {fila.cancha}</span>
      {fila.celdas.map((c, i) =>
        c.estado === 'reservada' ? (
          <button key={i} title={`${horas[i]} · ${c.detalle}`} aria-label={`Cancha ${fila.cancha}, ${horas[i]}: ${c.detalle}`}
            onClick={() => onReservada(c, fila.cancha, horas[i])}
            className={`h-8 rounded border ${COLOR.reservada}`} />
        ) : (
          <span key={i} title={`${horas[i]} · ${c.estado === 'bloqueada' ? c.detalle : 'Libre'}`}
            className={`h-8 rounded border ${COLOR[c.estado]}`} />
        ),
      )}
    </>
  )
}

function Selector({ id, label, valor, setValor, opciones }) {
  return (
    <div className="flex flex-1 flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-bold">{label}</label>
      <select id={id} value={valor} onChange={(e) => setValor(e.target.value)}
        className="h-11 rounded-xl border-[1.5px] border-borde bg-white px-2.5 text-[15px]">
        {opciones.map((o) => <option key={o}>{o}</option>)}
      </select>
    </div>
  )
}
