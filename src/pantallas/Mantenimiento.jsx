import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { fechaLarga, hoy, sumarDias } from '../lib/fechas'
import { Aviso, Cargando, Titulo } from '../componentes/ui'
import Login from './Login'
import { CambiarClave, Fila, HORAS, Selector, agrupar, rangos } from './Capitania'

// /mantenimiento: grilla pública de ocupación (sin nombres de socios).
// El encargado ingresa con usuario y clave para agregar, modificar o borrar bloqueos de mantenimiento.
export default function Mantenimiento({ sesion, onIngresar, onError, aviso }) {
  const [fecha, setFecha] = useState(hoy())
  const [dia, setDia] = useState(null)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [foco, setFoco] = useState(null)
  const [ingresando, setIngresando] = useState(false)
  const [errorIngreso, setErrorIngreso] = useState('')

  const ultimo = useRef(0)
  const cargar = useCallback(() => {
    const id = ++ultimo.current
    return api.ocupacionDia(fecha)
      .then((d) => { if (id === ultimo.current) { setDia(d); setError('') } })
      .catch((e) => id === ultimo.current && setError(e.message))
  }, [fecha])
  useEffect(() => { cargar() }, [cargar])
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) cargar() }, 30000)
    const alVolver = () => { if (!document.hidden) cargar() }
    document.addEventListener('visibilitychange', alVolver)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', alVolver) }
  }, [cargar])
  useEffect(() => { setFoco(null); setOk('') }, [fecha])
  useEffect(() => { if (sesion) setIngresando(false) }, [sesion])

  const visible = dia?.fecha === fecha ? dia : null
  const grilla = visible ?? dia
  const grupos = agrupar(visible?.bloqueos ?? [])
  const mios = grupos.filter((g) => g.mantenimiento)

  function ingresar(s) {
    const problema = onIngresar(s)
    setErrorIngreso(problema ?? '')
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Titulo sub={fechaLarga(fecha)}>Canchas de tenis</Titulo>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setFecha(sumarDias(fecha, -1))} aria-label="Día anterior"
            className="flex size-11 items-center justify-center rounded-xl border-[1.5px] border-borde bg-superficie text-tinta hover:border-verde">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
          </button>
          <button type="button" onClick={() => setFecha(hoy())} disabled={fecha === hoy()}
            className="h-11 rounded-xl border-[1.5px] border-verde bg-superficie px-4 font-bold text-verde hover:bg-verde-claro disabled:border-borde disabled:text-gris disabled:hover:bg-superficie">
            Hoy
          </button>
          <button type="button" onClick={() => setFecha(sumarDias(fecha, 1))} aria-label="Día siguiente"
            className="flex size-11 items-center justify-center rounded-xl border-[1.5px] border-borde bg-superficie text-tinta hover:border-verde">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </button>
          <input type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} aria-label="Ir a una fecha"
            className="h-11 rounded-xl border-[1.5px] border-borde bg-superficie px-3 text-base" />
        </div>
      </div>

      {aviso && <Aviso tipo="alerta">{aviso}</Aviso>}
      {error && <Aviso tipo="error">{error}</Aviso>}
      {ok && <Aviso>{ok}</Aviso>}

      <div className="flex flex-wrap gap-4 text-[13px] text-gris">
        <span className="inline-flex items-center gap-1.5"><span className="size-3.5 rounded border border-borde bg-superficie" />Libre</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3.5 rounded bg-reservada" />En uso</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3.5 rounded bg-azul" />Bloqueada</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3.5 rounded bg-mant" />Mantenimiento</span>
      </div>

      <p aria-live="polite" className="-mb-2 min-h-6 truncate text-[14px] text-tinta">
        {foco ? (
          <><strong>Cancha {foco.cancha} · {foco.hora}</strong>{' — '}
            {foco.estado === 'libre' ? 'Libre' : foco.estado === 'reservada' ? 'En uso' : foco.detalle}</>
        ) : <span className="text-gris">Tocá o pasá el mouse por una celda para ver el detalle.</span>}
      </p>

      <div className="relative min-h-[556px] overflow-x-auto rounded-2xl border border-borde bg-superficie p-3" aria-busy={!visible}
        onMouseLeave={() => setFoco(null)}>
        {grilla ? (
          <div className={`grid gap-0.5 transition-opacity ${visible ? '' : 'opacity-40'}`}
            style={{ gridTemplateColumns: `76px repeat(${grilla.horas.length}, minmax(24px, 1fr))`, minWidth: 820 }}>
            <span className="sticky -left-3 z-10 -ml-3 bg-superficie pl-3" />
            {grilla.horas.map((h, i) => (
              <span key={h} className="whitespace-nowrap pb-1 text-[11px] font-bold text-gris">{i % 2 === 0 ? h : ''}</span>
            ))}
            {grilla.filas.map((f) => (
              <Fila key={f.cancha} fila={f} horas={grilla.horas} onReservada={(c, cancha, hora) => setFoco({ cancha, hora, estado: c.estado })}
                onFoco={setFoco} enBloque={() => false} />
            ))}
          </div>
        ) : (
          <div className="flex min-h-[530px] items-center justify-center"><Cargando /></div>
        )}
      </div>

      {!sesion && !ingresando && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-borde bg-superficie p-4">
          <span className="text-[15px]">¿Necesitás modificar canchas para mantenimiento?</span>
          <button onClick={() => setIngresando(true)} className="min-h-11 rounded-xl bg-verde px-5 font-bold text-white hover:bg-verde-oscuro">
            Ingresar
          </button>
        </section>
      )}
      {!sesion && ingresando && (
        <section className="flex flex-col gap-3 rounded-2xl border border-borde bg-superficie p-4">
          {errorIngreso && <Aviso tipo="error">{errorIngreso}</Aviso>}
          <Login modo="mantenimiento" onIngresar={ingresar} />
          <button onClick={() => { setIngresando(false); setErrorIngreso('') }} className="min-h-11 self-center font-bold text-gris">Cancelar</button>
        </section>
      )}

      {sesion && (
        <EditorBloqueos sesion={sesion} fecha={fecha} mios={mios} onError={onError}
          onListo={(texto) => { setOk(texto); cargar() }} />
      )}
      {sesion && <CambiarClave sesion={sesion} onError={onError} />}
    </div>
  )
}

const VACIO = { canchas: [], desde: '08:00', hasta: '10:00', semanal: false, detalle: '' }

function EditorBloqueos({ sesion, fecha, mios, onListo, onError }) {
  const [f, setF] = useState(VACIO)
  const [editando, setEditando] = useState(null) // grupo que se está modificando
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setEditando(null); setF(VACIO); setError('') }, [fecha])

  const manejar = (e) => (e.codigo === 'SESION' ? onError(e) : setError(e.message))
  const alternar = (n) => setF((x) => ({ ...x, canchas: x.canchas.includes(n) ? x.canchas.filter((c) => c !== n) : [...x.canchas, n].sort((a, b) => a - b) }))
  const todas = f.canchas.length === 15

  function modificar(g) {
    setError('')
    setEditando(g)
    const detalle = g.motivo.replace(/^mantenimiento\s*(·\s*)?/i, '')
    setF({ canchas: g.canchas, desde: g.desde, hasta: g.hasta, semanal: g.semanal, detalle })
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
  }

  async function guardar(e) {
    e.preventDefault()
    if (f.hasta <= f.desde) return setError('El horario "hasta" tiene que ser posterior a "desde".')
    setGuardando(true)
    setError('')
    try {
      await api.mantGuardar(sesion.token, { ...f, fecha }, editando ? editando.ids : [])
      const texto = `${editando ? 'Bloqueo modificado' : 'Bloqueo guardado'}: cancha${f.canchas.length > 1 ? 's' : ''} ${rangos(f.canchas)} · ${f.desde} a ${f.hasta}${f.semanal ? ' · todas las semanas' : ''}.`
      setEditando(null)
      setF(VACIO)
      onListo(texto)
    } catch (err) { manejar(err) } finally { setGuardando(false) }
  }

  async function borrar(g) {
    if (!window.confirm(`${g.motivo}\nCancha${g.canchas.length > 1 ? 's' : ''} ${rangos(g.canchas)} · ${g.desde} a ${g.hasta}${g.semanal ? ' (todas las semanas)' : ''}\n\n¿Borrar este bloqueo?`)) return
    setError('')
    try {
      await api.mantBorrar(sesion.token, g.ids)
      if (editando?.clave === g.clave) { setEditando(null); setF(VACIO) }
      onListo('Bloqueo borrado.')
    } catch (err) { manejar(err) }
  }

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <section className="flex flex-col gap-3 rounded-2xl border border-borde bg-superficie p-4">
        <h2 className="text-lg font-bold">Bloqueos de mantenimiento · {fechaLarga(fecha)}</h2>
        {mios.length === 0 ? (
          <p className="text-[15px] text-gris">No hay bloqueos de mantenimiento este día.</p>
        ) : (
          <ul className="flex flex-col">
            {mios.map((g) => (
              <li key={g.clave} className={`flex items-center justify-between gap-3 border-b border-borde py-2.5 last:border-0 ${editando?.clave === g.clave ? 'bg-mant-claro' : ''}`}>
                <span className="flex min-w-0 flex-col">
                  <span className="text-[15px] font-bold">Cancha{g.canchas.length > 1 ? 's' : ''} {rangos(g.canchas)} · {g.desde} a {g.hasta}</span>
                  <span className="text-[13px] text-gris">{g.motivo}{g.semanal ? ' · todas las semanas' : ''}</span>
                </span>
                <span className="flex shrink-0 gap-1.5">
                  <button onClick={() => modificar(g)} className="min-h-11 rounded-lg border-[1.5px] border-borde px-3 text-sm font-bold hover:border-verde">Modificar</button>
                  <button onClick={() => borrar(g)} className="min-h-11 rounded-lg border-[1.5px] border-error px-3 text-sm font-bold text-error hover:bg-error-claro">Borrar</button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[13px] leading-snug text-gris">
          Los bloqueos de la Capitanía (Escuela, torneos, lluvia) se ven en azul y no se pueden modificar desde acá.
        </p>
      </section>

      <form onSubmit={guardar} className="flex flex-col gap-3 rounded-2xl border border-borde bg-superficie p-4">
        <h2 className="text-lg font-bold">{editando ? 'Modificar bloqueo' : 'Bloquear por mantenimiento'}</h2>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 flex w-full items-center justify-between text-[13px] font-bold">
            Canchas
            <button type="button" onClick={() => setF((x) => ({ ...x, canchas: todas ? [] : Array.from({ length: 15 }, (_, i) => i + 1) }))}
              className="min-h-8 px-1 text-[13px] font-bold text-verde">{todas ? 'Ninguna' : 'Todas'}</button>
          </legend>
          <div className="grid grid-cols-5 gap-1.5">
            {Array.from({ length: 15 }, (_, i) => i + 1).map((n) => (
              <button type="button" key={n} onClick={() => alternar(n)} aria-pressed={f.canchas.includes(n)}
                className={`min-h-11 rounded-lg border-[1.5px] font-bold ${f.canchas.includes(n) ? 'border-mant bg-mant text-white' : 'border-borde bg-superficie'}`}>
                {n}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="flex gap-3">
          <Selector id="mant-desde" label="Desde" valor={f.desde} setValor={(v) => setF({ ...f, desde: v })} opciones={HORAS.slice(0, -1)} />
          <Selector id="mant-hasta" label="Hasta" valor={f.hasta} setValor={(v) => setF({ ...f, hasta: v })} opciones={HORAS.slice(1)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="mant-detalle" className="text-[13px] font-bold">Detalle (opcional)</label>
          <input id="mant-detalle" value={f.detalle} onChange={(e) => setF({ ...f, detalle: e.target.value })} maxLength={60}
            placeholder="Ej.: Riego, Pasada de rastrillo, Cambio de red"
            className="h-11 rounded-xl border-[1.5px] border-borde bg-superficie px-3 text-[15px] outline-none focus:border-verde" />
        </div>
        <label className="flex min-h-8 items-center gap-2 text-[15px]">
          <input type="checkbox" checked={f.semanal} onChange={(e) => setF({ ...f, semanal: e.target.checked })} className="size-4.5 accent-mant" />
          Repetir todas las semanas (mismo día y horario)
        </label>
        {error && (
          <Aviso tipo="error">{error}</Aviso>
        )}
        <div className="flex flex-wrap gap-2">
          <button disabled={guardando || f.canchas.length === 0}
            className="h-12 flex-1 rounded-xl bg-mant px-4 font-bold text-white hover:bg-mant-oscuro disabled:bg-apagado disabled:text-gris">
            {guardando ? 'Guardando…' : f.canchas.length === 0 ? 'Elegí al menos una cancha' : editando ? 'Guardar cambios' : 'Bloquear'}
          </button>
          {editando && (
            <button type="button" onClick={() => { setEditando(null); setF(VACIO); setError('') }}
              className="h-12 rounded-xl border-[1.5px] border-borde px-4 font-bold">Cancelar</button>
          )}
        </div>
        <p className="text-[13px] leading-snug text-gris">
          Si la cancha tiene un partido reservado en ese horario, no se puede bloquear: coordiná con la Capitanía para mover o cancelar el partido.
        </p>
      </form>
    </div>
  )
}
