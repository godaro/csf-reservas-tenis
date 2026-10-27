import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { fechaCorta, fechaLarga, hoy, sumarDias } from '../lib/fechas'
import { Aviso, Cargando, Titulo } from '../componentes/ui'

const MOTIVOS = ['Escuela de Tenis', 'Clases', 'Interclubes', 'Torneo interno', 'Mantenimiento', 'Lluvia', 'Otro']
const HORAS = Array.from({ length: 29 }, (_, i) => {
  const m = 8 * 60 + i * 30
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${m % 60 ? '30' : '00'}`
})

const COLOR = {
  libre: 'bg-white border-borde',
  reservada: 'bg-[#9ccbae] border-[#9ccbae] cursor-pointer',
  bloqueada: 'bg-azul border-azul cursor-pointer',
}
// Mismo bloque bajo el mouse (todas sus celdas juntas)
const COLOR_FOCO = {
  reservada: 'bg-[#5fa97c] border-[#3f8a5d]',
  bloqueada: 'bg-[#3d63ad] border-[#22427f]',
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
  const [motivoOtro, setMotivoOtro] = useState('')
  const motivoFinal = motivo === 'Otro' ? motivoOtro.trim() : motivo
  // Celda o bloqueo bajo el mouse: resalta la grilla y la lista de bloqueos entre sí
  const [foco, setFoco] = useState(null) // { cancha, hora, estado, detalle } de una celda
  const [grupoFoco, setGrupoFoco] = useState(null) // clave de un bloqueo de la lista
  const [semanal, setSemanal] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [conflicto, setConflicto] = useState(null) // { datos, afectadas: [...] }
  // Si cambian los datos del formulario, el aviso anterior ya no aplica
  useEffect(() => { setConflicto(null) }, [canchas, desde, hasta, motivo, motivoOtro, semanal, fecha])
  useEffect(() => { setFoco(null); setGrupoFoco(null) }, [fecha])

  // Cerrar todas las canchas (lluvia / mantenimiento)
  const [cierreMotivo, setCierreMotivo] = useState('Lluvia')
  const [cierre, setCierre] = useState(null) // { datos, afectadas }
  useEffect(() => { setCierre(null) }, [fecha, cierreMotivo])
  const esHoy = fecha === hoy()
  const desdeCierre = esHoy ? medioHoraActual() : HORAS[0]
  const diaTerminado = esHoy && desdeCierre >= HORAS[HORAS.length - 1]

  async function cerrarDia() {
    setGuardando(true)
    setError('')
    setOk('')
    const datos = {
      canchas: Array.from({ length: 15 }, (_, i) => i + 1),
      fecha, desde: desdeCierre, hasta: HORAS[HORAS.length - 1], motivo: cierreMotivo, semanal: false,
    }
    try {
      const afectadas = await api.previsualizarBloqueo(sesion.token, datos)
      setCierre({ datos, afectadas })
    } catch (err) {
      manejar(err)
    } finally {
      setGuardando(false)
    }
  }

  async function confirmarCierre() {
    await crear(cierre.datos, true)
    setCierre(null)
  }

  const manejar = useCallback((e) => (e.codigo === 'SESION' ? onError(e) : setError(e.message)), [onError])

  // Solo se muestra la respuesta del último pedido (evita que un día viejo pise al nuevo)
  const ultimo = useRef(0)
  const cargar = useCallback(() => {
    const id = ++ultimo.current
    return api.panelDia(sesion.token, fecha)
      .then((p) => { if (id === ultimo.current) { setPanel(p); setError('') } })
      .catch((e) => id === ultimo.current && manejar(e))
  }, [sesion.token, fecha, manejar])

  useEffect(() => { cargar() }, [cargar])

  // Se actualiza solo: cada 30 segundos y cada vez que se vuelve a la pestaña
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) cargar() }, 30000)
    const alVolver = () => { if (!document.hidden) cargar() }
    document.addEventListener('visibilitychange', alVolver)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', alVolver) }
  }, [cargar])
  const panelVisible = panel?.fecha === fecha ? panel : null
  const grupos = agrupar(panelVisible?.bloqueos ?? [])
  const cubre = (g, cancha, hora) => g.canchas.includes(cancha) && g.desde <= hora && hora < g.hasta
  const gruposDeFoco = foco?.estado === 'bloqueada' ? grupos.filter((g) => cubre(g, foco.cancha, foco.hora)).map((g) => g.clave) : []
  const grupoResaltado = grupos.find((g) => g.clave === grupoFoco)
  const celdaResaltada = (cancha, hora) => (grupoResaltado ? cubre(grupoResaltado, cancha, hora) : false)
  // Bloque completo bajo el mouse: todas las celdas de ese bloqueo o esa reserva en la misma cancha
  const gruposFoco = grupos.filter((g) => gruposDeFoco.includes(g.clave))
  const enBloqueFoco = (cancha, hora, celda) => {
    if (!foco || foco.cancha !== cancha || celda.estado !== foco.estado) return false
    if (foco.estado === 'bloqueada') return gruposFoco.some((g) => cubre(g, cancha, hora))
    if (foco.estado === 'reservada') return celda.reserva_id === foco.reserva_id
    return false
  }
  const grilla = panelVisible ?? panel // mientras carga otro día, se ve la grilla anterior atenuada

  const alternarCancha = (n) =>
    setCanchas((c) => (c.includes(n) ? c.filter((x) => x !== n) : [...c, n].sort((a, b) => a - b)))

  // Paso 1: revisar si el bloqueo pisa reservas. Si no pisa nada, se crea directo.
  async function bloquear(e) {
    e.preventDefault()
    setGuardando(true)
    setError('')
    setOk('')
    setConflicto(null)
    const datos = { canchas, fecha, desde, hasta, motivo: motivoFinal, semanal }
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
      await cargar()
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

  async function borrar(g) {
    const donde = g.canchas.length === 1 ? `la cancha ${g.canchas[0]}` : `las canchas ${rangos(g.canchas)}`
    if (!window.confirm(`¿Borrar el bloqueo "${g.motivo}" de ${donde}${g.semanal ? ' (todas las semanas)' : ''}?\n\nLas reservas que se hayan cancelado por este bloqueo no se recuperan.`)) return
    setError('')
    setOk('')
    try {
      await Promise.all(g.ids.map((id) => api.borrarBloqueo(sesion.token, id)))
      await cargar()
      setOk(`Bloqueo "${g.motivo}" borrado.`)
    } catch (e) { manejar(e); cargar() }
  }

  // Libera todos los bloqueos puntuales del día (los semanales se mantienen)
  async function desbloquearDia() {
    const puntuales = (panelVisible?.bloqueos ?? []).filter((b) => !b.semanal)
    const haySemanales = (panelVisible?.bloqueos ?? []).some((b) => b.semanal)
    if (!window.confirm(`¿Desbloquear todas las canchas del ${fechaLarga(fecha)}?` +
      (haySemanales ? '\n\nLos bloqueos semanales (que se repiten todas las semanas) se mantienen.' : '') +
      '\n\nLas reservas que se hayan cancelado por estos bloqueos no se recuperan.')) return
    setError('')
    setOk('')
    try {
      await Promise.all(puntuales.map((b) => api.borrarBloqueo(sesion.token, b.id)))
      await cargar()
      setOk('Canchas desbloqueadas.')
    } catch (e) { manejar(e); cargar() }
  }

  async function cancelarReserva(celda, cancha, horaTxt) {
    if (!window.confirm(`Cancha ${cancha} · ${horaTxt}\n${celda.detalle}\n\n¿Cancelar esta reserva?`)) return
    setError('')
    setOk('')
    try {
      await api.cancelar(sesion.token, celda.reserva_id)
      await cargar()
      setOk(`Reserva de la cancha ${cancha} cancelada.`)
    } catch (e) { manejar(e); cargar() }
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

      <p aria-live="polite" className="-mb-2 min-h-6 truncate text-[14px] text-tinta">
        {foco ? (
          <><strong>Cancha {foco.cancha} · {foco.hora}</strong>{' — '}
            {foco.estado === 'libre' ? 'Libre'
              : foco.estado === 'reservada' ? `Reservada: ${foco.detalle}`
                : `Bloqueada: ${grupos.filter((g) => cubre(g, foco.cancha, foco.hora)).map((g) => `${g.motivo} (${g.desde} a ${g.hasta}${g.semanal ? ', todas las semanas' : ''})`).join(' · ') || foco.detalle}`}</>
        ) : grupoResaltado ? (
          <><strong>{grupoResaltado.motivo}</strong> · {grupoResaltado.desde} a {grupoResaltado.hasta}</>
        ) : <span className="text-gris">Pasá el mouse por una celda para ver el detalle.</span>}
      </p>

      {/* Alto mínimo = 15 canchas, así el contenido no salta mientras carga */}
      <div className="relative min-h-[556px] overflow-x-auto rounded-2xl border border-borde bg-white p-3" aria-busy={!panelVisible}
        onMouseLeave={() => setFoco(null)}>
        {grilla ? (
          <div className={`grid gap-0.5 transition-opacity ${panelVisible ? '' : 'opacity-40'}`}
            style={{ gridTemplateColumns: `76px repeat(${grilla.horas.length}, minmax(24px, 1fr))`, minWidth: 820 }}>
            <span />
            {grilla.horas.map((h, i) => (
              <span key={h} className="whitespace-nowrap pb-1 text-[11px] font-bold text-gris">{i % 2 === 0 ? h : ''}</span>
            ))}
            {grilla.filas.map((f) => (
              <Fila key={f.cancha} fila={f} horas={grilla.horas} onReservada={panelVisible ? cancelarReserva : () => {}}
                onFoco={setFoco} resaltada={celdaResaltada} enBloque={enBloqueFoco} />
            ))}
          </div>
        ) : (
          <div className="flex min-h-[530px] items-center justify-center"><Cargando /></div>
        )}
      </div>

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
          {motivo === 'Otro' && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="motivo-otro" className="text-[13px] font-bold">¿Cuál es el motivo?</label>
              <input id="motivo-otro" value={motivoOtro} onChange={(e) => setMotivoOtro(e.target.value)} maxLength={60} required autoFocus
                placeholder="Ej.: Clínica de saque, Evento del Club" 
                className="h-11 rounded-xl border-[1.5px] border-borde bg-white px-3 text-[15px] outline-none focus:border-azul" />
              <span className="text-[12px] text-gris">Los socios lo ven en el aviso si el bloqueo les cancela una reserva.</span>
            </div>
          )}
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
          <button disabled={guardando || canchas.length === 0 || !!conflicto || !motivoFinal}
            className="h-12 rounded-xl bg-azul font-bold text-white disabled:bg-apagado disabled:text-gris">
            {guardando ? 'Guardando…' : canchas.length === 0 ? 'Elegí al menos una cancha' : !motivoFinal ? 'Escribí el motivo' : 'Bloquear franja'}
          </button>
        </form>

        {/* Mide lo mismo que "Bloquear canchas": si hay muchos bloqueos, la lista scrollea */}
        <div className="flex min-h-0 flex-col gap-2 rounded-2xl border border-borde bg-white p-4 md:relative">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">Bloqueos del día</h2>
            {(panelVisible?.bloqueos ?? []).some((b) => !b.semanal) && (
              <button type="button" onClick={desbloquearDia}
                className="min-h-11 rounded-lg border-[1.5px] border-error px-3 text-sm font-bold text-error hover:bg-[#fdf3f2]">
                Desbloquear todo
              </button>
            )}
          </div>
          {panelVisible?.bloqueos.length === 0 && <p className="text-[15px] text-gris">Sin bloqueos para este día.</p>}
          <div className="-mr-2 flex max-h-96 flex-col gap-2 overflow-y-auto pr-2 md:absolute md:inset-x-4 md:bottom-4 md:top-[72px] md:mr-0 md:max-h-none">
          {grupos.map((g) => (
            <div key={g.clave} onMouseEnter={() => setGrupoFoco(g.clave)} onMouseLeave={() => setGrupoFoco(null)}
              className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 transition ${
                gruposDeFoco.includes(g.clave) || grupoFoco === g.clave ? 'bg-[#cfdaf0] ring-2 ring-azul' : 'bg-azul-claro'
              }`}>
              <span className="flex flex-col">
                <strong className="text-azul">
                  {g.motivo} · {g.canchas.length === 15 ? 'Todas las canchas' : g.canchas.length === 1 ? `Cancha ${g.canchas[0]}` : `Canchas ${rangos(g.canchas)}`}
                </strong>
                <span className="text-[13px] text-azul">{g.desde} a {g.hasta}{g.semanal ? ' · todas las semanas' : ''}</span>
              </span>
              <button onClick={() => borrar(g)} className="min-h-11 px-2 text-sm font-bold text-error">Borrar</button>
            </div>
          ))}
          </div>
        </div>
      </div>

      <section className="flex flex-col gap-3 rounded-2xl border border-[#f2d3a6] bg-[#fff8ee] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col">
            <h2 className="text-lg font-bold">Cerrar todas las canchas</h2>
            <span className="text-[14px] text-gris">
              {diaTerminado ? 'Ya terminó el horario de hoy.'
                : esHoy ? `Desde ahora (${desdeCierre}) hasta el cierre · cancela las reservas que queden.`
                  : `Todo el ${fechaLarga(fecha)} · cancela todas las reservas del día.`}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {['Lluvia', 'Mantenimiento'].map((m) => (
              <button key={m} type="button" onClick={() => setCierreMotivo(m)} aria-pressed={cierreMotivo === m}
                className={`min-h-11 rounded-full border-[1.5px] px-4 font-bold ${cierreMotivo === m ? 'border-[#8a4b00] bg-[#8a4b00] text-white' : 'border-borde bg-white text-tinta'}`}>
                {m}
              </button>
            ))}
            <button type="button" onClick={cerrarDia} disabled={guardando || diaTerminado || !!cierre}
              className="min-h-11 rounded-xl bg-[#8a4b00] px-4 font-bold text-white disabled:bg-apagado disabled:text-gris">
              Cerrar canchas
            </button>
          </div>
        </div>
        {cierre && (
          <div role="alert" className="flex flex-col gap-3 rounded-xl border border-[#f2d3a6] bg-white p-3.5 text-[#4a3a22]">
            <strong className="text-[15px]">
              Se cierran las 15 canchas por {cierre.datos.motivo.toLowerCase()}, de {cierre.datos.desde} a {cierre.datos.hasta}.
              {' '}{cierre.afectadas.length === 0 ? 'No hay reservas para cancelar.'
                : cierre.afectadas.length === 1 ? 'Se cancela 1 reserva:' : `Se cancelan ${cierre.afectadas.length} reservas:`}
            </strong>
            {cierre.afectadas.length > 0 && (
              <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto text-[14px]">
                {cierre.afectadas.map((a) => (
                  <li key={a.id}><strong>Cancha {a.cancha}</strong> · {a.hora_inicio} a {a.hora_fin} · {a.jugadores}</li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={guardando} onClick={confirmarCierre}
                className="min-h-11 rounded-lg bg-error px-4 font-bold text-white disabled:opacity-60">
                {guardando ? 'Guardando…' : 'Confirmar cierre'}
              </button>
              <button type="button" onClick={() => setCierre(null)} className="min-h-11 rounded-lg px-4 font-bold text-[#8a4b00]">
                Volver
              </button>
            </div>
          </div>
        )}
      </section>

      <CambiarClave sesion={sesion} onError={onError} />
    </div>
  )
}

function CambiarClave({ sesion, onError }) {
  const [abierto, setAbierto] = useState(false)
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [repetir, setRepetir] = useState('')
  const [msg, setMsg] = useState(null) // { tipo, texto }
  const [guardando, setGuardando] = useState(false)

  async function guardar(e) {
    e.preventDefault()
    setMsg(null)
    if (nueva.length < 8) return setMsg({ tipo: 'error', texto: 'La clave nueva tiene que tener al menos 8 caracteres.' })
    if (nueva !== repetir) return setMsg({ tipo: 'error', texto: 'Las dos claves nuevas no coinciden.' })
    setGuardando(true)
    try {
      await api.cambiarClave(sesion.token, actual, nueva)
      setActual(''); setNueva(''); setRepetir('')
      setMsg({ tipo: 'info', texto: 'Clave cambiada. Se cerraron las otras sesiones abiertas con este usuario.' })
    } catch (err) {
      if (err.codigo === 'SESION') onError(err)
      else setMsg({ tipo: 'error', texto: err.message })
    } finally {
      setGuardando(false)
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-borde bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <h2 className="text-lg font-bold">Mi cuenta</h2>
          <span className="text-[14px] text-gris">Ingresaste como {sesion.nombre}.</span>
        </div>
        <button type="button" onClick={() => { setAbierto(!abierto); setMsg(null) }} aria-expanded={abierto}
          className="min-h-11 rounded-lg border-[1.5px] border-borde px-3 text-sm font-bold text-tinta hover:border-verde">
          {abierto ? 'Cerrar' : 'Cambiar clave'}
        </button>
      </div>
      {abierto && (
        <form onSubmit={guardar} className="grid gap-3 sm:grid-cols-3">
          {[['clave-actual', 'Clave actual', actual, setActual, 'current-password'],
            ['clave-nueva', 'Clave nueva (mín. 8)', nueva, setNueva, 'new-password'],
            ['clave-repetir', 'Repetir clave nueva', repetir, setRepetir, 'new-password']].map(([id, label, v, set, ac]) => (
            <div key={id} className="flex flex-col gap-1.5">
              <label htmlFor={id} className="text-[13px] font-bold">{label}</label>
              <input id={id} type="password" autoComplete={ac} value={v} onChange={(e) => set(e.target.value)} required
                className="h-11 rounded-xl border-[1.5px] border-borde bg-white px-3 text-base outline-none focus:border-verde" />
            </div>
          ))}
          {msg && <div className="sm:col-span-3"><Aviso tipo={msg.tipo}>{msg.texto}</Aviso></div>}
          <div className="sm:col-span-3">
            <button disabled={guardando} className="h-11 rounded-xl bg-verde px-5 font-bold text-white disabled:opacity-60">
              {guardando ? 'Guardando…' : 'Guardar clave nueva'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

// Media hora en curso en el Club (ej. 15:47 → "15:30"), nunca antes de la apertura
function medioHoraActual() {
  const t = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' })
  const [h, m] = t.split(':').map(Number)
  const hhmm = `${String(h).padStart(2, '0')}:${m < 30 ? '00' : '30'}`
  return hhmm < HORAS[0] ? HORAS[0] : hhmm
}

// Junta los bloqueos con mismo motivo y horario en una sola fila
function agrupar(bloqueos) {
  const grupos = new Map()
  for (const b of bloqueos) {
    const clave = `${b.motivo}|${b.desde}|${b.hasta}|${b.semanal}`
    if (!grupos.has(clave)) grupos.set(clave, { clave, motivo: b.motivo, desde: b.desde, hasta: b.hasta, semanal: b.semanal, canchas: [], ids: [] })
    grupos.get(clave).canchas.push(b.cancha)
    grupos.get(clave).ids.push(b.id)
  }
  return [...grupos.values()].map((g) => ({ ...g, canchas: g.canchas.sort((a, b) => a - b) }))
}

// [1,2,3,4,7,9,10] → "1–4, 7, 9–10"
function rangos(ns) {
  const partes = []
  for (let i = 0; i < ns.length; i++) {
    let j = i
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++
    partes.push(j > i ? `${ns[i]}–${ns[j]}` : `${ns[i]}`)
    i = j
  }
  return partes.join(', ')
}

function Fila({ fila, horas, onReservada, onFoco, resaltada, enBloque }) {
  return (
    <>
      <span className="flex h-8 items-center text-[13px] font-bold">Cancha {fila.cancha}</span>
      {fila.celdas.map((c, i) => {
        const info = { cancha: fila.cancha, hora: horas[i], estado: c.estado, detalle: c.detalle, reserva_id: c.reserva_id }
        const marca = resaltada(fila.cancha, horas[i]) ? ' ring-2 ring-dorado ring-offset-1' : ''
        const color = enBloque(fila.cancha, horas[i], c) ? `${COLOR_FOCO[c.estado]} cursor-pointer` : COLOR[c.estado]
        return c.estado === 'reservada' ? (
          <button key={i} aria-label={`Cancha ${fila.cancha}, ${horas[i]}: ${c.detalle}`}
            onMouseEnter={() => onFoco(info)} onFocus={() => onFoco(info)}
            onClick={() => onReservada(c, fila.cancha, horas[i])}
            className={`h-8 rounded border transition-colors ${color}${marca}`} />
        ) : (
          <span key={i} onMouseEnter={() => onFoco(info)}
            className={`h-8 rounded border transition-colors ${color}${marca}`} />
        )
      })}
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
