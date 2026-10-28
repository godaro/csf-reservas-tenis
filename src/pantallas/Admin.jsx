import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { momento } from '../lib/fechas'
import { leerPadron } from '../lib/padron'
import { Aviso, Cargando, Titulo } from '../componentes/ui'
import { CambiarClave } from './Capitania'

// Administración: padrón de socios con carnet de tenis
export default function Admin({ sesion, onError }) {
  const [resumen, setResumen] = useState(null)
  const [aviso, setAviso] = useState(null) // { tipo, texto }
  const [refrescar, setRefrescar] = useState(0)

  const manejar = useCallback((e) => {
    if (e.codigo === 'SESION') onError(e)
    else setAviso({ tipo: 'error', texto: e.message })
  }, [onError])

  useEffect(() => {
    api.adminResumen(sesion.token).then(setResumen).catch(manejar)
  }, [sesion.token, refrescar, manejar])

  const listo = (texto) => { setAviso({ tipo: 'info', texto }); setRefrescar((n) => n + 1); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  return (
    <div className="flex flex-col gap-5">
      <Titulo sub={resumen ? lineaResumen(resumen) : 'Cargando…'}>Socios con carnet de tenis</Titulo>
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

      <CargarExcel sesion={sesion} resumen={resumen} onListo={listo} onError={manejar} />
      <div className="grid gap-5 lg:grid-cols-2">
        <AltaManual sesion={sesion} onListo={listo} onError={manejar} />
        <BuscarSocio sesion={sesion} refrescar={refrescar} onListo={listo} onError={manejar} />
      </div>
      <CambiarClave sesion={sesion} onError={onError} />
    </div>
  )
}

function lineaResumen(r) {
  const partes = [`${r.con_carnet} con carnet vigente`]
  if (r.manuales) partes.push(`${r.manuales} ${r.manuales === 1 ? 'alta manual' : 'altas manuales'}`)
  partes.push(r.ultima ? `Última carga: ${momento(r.ultima.cargado)}` : 'Todavía no se cargó ningún Excel desde acá')
  return partes.join(' · ')
}

function Tarjeta({ titulo, sub, children }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-borde bg-white p-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-lg font-bold">{titulo}</h2>
        {sub && <p className="text-[14px] leading-snug text-gris">{sub}</p>}
      </div>
      {children}
    </section>
  )
}

const BOTON = 'h-11 rounded-xl bg-verde px-5 font-bold text-white hover:bg-verde-oscuro disabled:opacity-60'
const BOTON_2 = 'h-11 rounded-xl border-[1.5px] border-borde bg-white px-4 font-bold text-tinta hover:border-verde disabled:opacity-60'

// ---------------------------------------------------------------------
// Excel semanal
// ---------------------------------------------------------------------
function CargarExcel({ sesion, resumen, onListo, onError }) {
  const input = useRef(null)
  const [archivo, setArchivo] = useState(null)
  const [leyendo, setLeyendo] = useState(false)
  const [errores, setErrores] = useState([])
  const [filas, setFilas] = useState(null)
  const [plan, setPlan] = useState(null)
  const [mantener, setMantener] = useState([])
  const [aplicando, setAplicando] = useState(false)

  function descartar() {
    setArchivo(null); setFilas(null); setPlan(null); setErrores([]); setMantener([])
    if (input.current) input.current.value = ''
  }

  async function elegir(e) {
    const f = e.target.files?.[0]
    if (!f) return
    descartar()
    setArchivo(f.name)
    setLeyendo(true)
    try {
      const { readSheet } = await import('read-excel-file/browser')
      const rows = await readSheet(f)
      const r = leerPadron(rows)
      if (r.errores.length) return setErrores(r.errores)
      const datos = r.filas.map(({ nro, dni, nombre, apellido, email, celular }) => ({ nro, dni, nombre, apellido, email, celular }))
      setFilas(datos)
      setPlan(await api.adminPrevisualizar(sesion.token, datos))
    } catch (err) {
      if (err.codigo || err.code) onError(err)
      else setErrores(['No pudimos leer el archivo. Tiene que ser un Excel (.xlsx) con las columnas Socio, Nombre, Teléfono, Email y Dni.'])
    } finally {
      setLeyendo(false)
    }
  }

  async function aplicar() {
    setAplicando(true)
    try {
      const r = await api.adminAplicar(sesion.token, filas, mantener, archivo)
      descartar()
      onListo(`Padrón actualizado: ${r.filas} socios en el Excel · ${r.altas} altas · ${r.bajas} bajas · ${r.cambios} con datos actualizados${r.mantenidos ? ` · ${r.mantenidos} mantenidos a mano` : ''}.`)
    } catch (err) {
      onError(err)
    } finally {
      setAplicando(false)
    }
  }

  const sospechoso = plan && resumen && resumen.con_carnet > 50 && plan.filas < resumen.con_carnet * 0.8
  const bajasManuales = plan?.bajas.filter((b) => b.manual) ?? []
  const bajasPadron = plan?.bajas.filter((b) => !b.manual) ?? []

  return (
    <Tarjeta titulo="Cargar el Excel semanal"
      sub="El Excel de AF Sistemas con todos los socios con carnet de tenis vigente. Antes de guardar te mostramos qué cambia.">
      <div className="flex flex-wrap items-center gap-3">
        <label className={`${BOTON} inline-flex cursor-pointer items-center`}>
          Elegir Excel
          <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={elegir} className="sr-only" />
        </label>
        {archivo && <span className="text-[14px] text-gris">{archivo}</span>}
      </div>

      {leyendo && <Cargando texto="Leyendo el Excel…" />}
      {errores.map((e) => <Aviso key={e} tipo="error">{e}</Aviso>)}

      {plan && (
        <div className="flex flex-col gap-3">
          {sospechoso && (
            <Aviso tipo="alerta">
              <strong className="block">¿Es el Excel completo?</strong>
              Trae {plan.filas} socios y hoy hay {resumen.con_carnet} con carnet. Si aplicás esta carga, {plan.bajas.length} socios pierden el carnet.
            </Aviso>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Numero valor={plan.filas} texto="socios en el Excel" />
            <Numero valor={plan.altas.length} texto="altas" color="text-verde" />
            <Numero valor={plan.bajas.length} texto="bajas" color={plan.bajas.length ? 'text-error' : undefined} />
            <Numero valor={plan.cambios.length} texto="con datos nuevos" />
          </div>

          {plan.altas.length > 0 && (
            <Lista titulo={`Altas (${plan.altas.length})`}>
              {plan.altas.map((a) => <Item key={a.nro} nombre={a.nombre} nro={a.nro} nota={a.nuevo ? 'Nuevo' : 'Vuelve a tener carnet'} />)}
            </Lista>
          )}

          {bajasManuales.length > 0 && (
            <div className="flex flex-col gap-2 rounded-xl border border-[#f2d3a6] bg-[#fff4e5] p-3">
              <span className="text-[15px] font-bold text-[#4a3a22]">Altas manuales que no vienen en el Excel ({bajasManuales.length})</span>
              <span className="text-[14px] text-[#4a3a22]">Se dan de baja. Tildá a quien quieras mantener (por ejemplo, si pagó después de exportar el Excel).</span>
              {bajasManuales.map((b) => (
                <label key={b.nro} className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px]">
                  <input type="checkbox" className="size-5 accent-verde" checked={mantener.includes(b.nro)}
                    onChange={(e) => setMantener((m) => (e.target.checked ? [...m, b.nro] : m.filter((x) => x !== b.nro)))} />
                  <span><strong>{b.nombre}</strong> · Socio {b.nro}{b.alta_manual_en ? ` · alta ${momento(b.alta_manual_en)}` : ''}</span>
                </label>
              ))}
            </div>
          )}

          {bajasPadron.length > 0 && (
            <Lista titulo={`Bajas: ya no vienen en el Excel (${bajasPadron.length})`}>
              {bajasPadron.map((b) => (
                <Item key={b.nro} nombre={b.nombre} nro={b.nro}
                  nota={b.reservas ? `${b.reservas} ${b.reservas === 1 ? 'reserva activa' : 'reservas activas'} (se mantienen)` : null} />
              ))}
            </Lista>
          )}

          {plan.confirmados.length > 0 && (
            <Lista titulo={`Altas manuales que llegan en el Excel (${plan.confirmados.length})`}>
              {plan.confirmados.map((c) => <Item key={c.nro} nombre={c.nombre} nro={c.nro} nota="Queda cargado como uno más" />)}
            </Lista>
          )}

          {plan.cambios.length > 0 && (
            <Lista titulo={`Datos que se actualizan (${plan.cambios.length})`}>
              {plan.cambios.map((c) => <Item key={c.nro} nombre={c.nombre} nro={c.nro} nota={c.campos.join(', ')} />)}
            </Lista>
          )}

          {plan.mails_invalidos.length > 0 && (
            <Lista titulo={`Sin mail válido: no reciben avisos (${plan.mails_invalidos.length})`}>
              {plan.mails_invalidos.map((m) => <Item key={m.nro} nombre={m.nombre} nro={m.nro} nota={m.email || 'Sin mail'} />)}
            </Lista>
          )}

          {plan.dni_repetidos.length > 0 && (
            <Lista titulo={`Mismo DNI en varios números de socio (${plan.dni_repetidos.length})`}>
              {plan.dni_repetidos.map((d) => <Item key={d.dni} nombre={`DNI ${d.dni}`} nota={`Socios ${d.nros.join(', ')}`} />)}
            </Lista>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <button onClick={aplicar} disabled={aplicando} className={BOTON}>
              {aplicando ? 'Guardando…' : 'Aplicar carga'}
            </button>
            <button onClick={descartar} disabled={aplicando} className={BOTON_2}>Descartar</button>
          </div>
        </div>
      )}
    </Tarjeta>
  )
}

function Numero({ valor, texto, color = 'text-tinta' }) {
  return (
    <div className="flex flex-col rounded-xl bg-fondo px-3 py-2.5">
      <span className={`font-display text-2xl font-semibold ${color}`}>{valor}</span>
      <span className="text-[13px] text-gris">{texto}</span>
    </div>
  )
}

function Lista({ titulo, children }) {
  return (
    <details className="group rounded-xl border border-borde">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 text-[15px] font-bold">
        {titulo}
        <span aria-hidden="true" className="text-gris transition group-open:rotate-180">▾</span>
      </summary>
      <ul className="max-h-72 overflow-y-auto border-t border-borde px-3 py-1">{children}</ul>
    </details>
  )
}

function Item({ nombre, nro, nota }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-borde py-2 text-[14px] last:border-0">
      <span><strong>{nombre}</strong>{nro && <span className="text-gris"> · Socio {nro}</span>}</span>
      {nota && <span className="text-gris">{nota}</span>}
    </li>
  )
}

// ---------------------------------------------------------------------
// Alta manual
// ---------------------------------------------------------------------
const VACIO = { nro: '', dni: '', nombre: '', apellido: '', email: '', celular: '' }

function AltaManual({ sesion, onListo, onError }) {
  const [d, setD] = useState(VACIO)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const campo = (k) => ({ value: d[k], onChange: (e) => setD({ ...d, [k]: e.target.value }) })

  async function guardar(e) {
    e.preventDefault()
    setError('')
    setGuardando(true)
    try {
      const r = await api.adminAlta(sesion.token, d)
      setD(VACIO)
      onListo(`${r.nombre} (socio ${r.nro}) ya tiene el carnet vigente y puede reservar.`)
    } catch (err) {
      if (err.codigo === 'SESION') onError(err)
      else setError(err.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Tarjeta titulo="Alta manual"
      sub="Para quien pagó el carnet en la semana: puede reservar en el momento. Cuando llegue en el Excel queda cargado como uno más; si no llega, la próxima carga lo da de baja.">
      <form onSubmit={guardar} className="grid gap-3 sm:grid-cols-2">
        <Entrada id="alta-nro" label="Número de socio" inputMode="numeric" required {...campo('nro')} />
        <Entrada id="alta-dni" label="DNI (sin puntos)" inputMode="numeric" required {...campo('dni')} />
        <Entrada id="alta-nombre" label="Nombre" required autoComplete="off" {...campo('nombre')} />
        <Entrada id="alta-apellido" label="Apellido" required autoComplete="off" {...campo('apellido')} />
        <Entrada id="alta-email" label="Mail (opcional)" type="email" autoComplete="off" {...campo('email')} />
        <Entrada id="alta-celular" label="Celular (opcional)" inputMode="tel" autoComplete="off" {...campo('celular')} />
        {error && <div className="sm:col-span-2"><Aviso tipo="error">{error}</Aviso></div>}
        <div className="sm:col-span-2">
          <button disabled={guardando} className={BOTON}>{guardando ? 'Guardando…' : 'Dar de alta'}</button>
        </div>
      </form>
    </Tarjeta>
  )
}

function Entrada({ id, label, ...props }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-bold">{label}</label>
      <input id={id} {...props}
        className="h-11 rounded-xl border-[1.5px] border-borde bg-white px-3 text-base outline-none focus:border-verde" />
    </div>
  )
}

// ---------------------------------------------------------------------
// Buscar socio / dar de baja
// ---------------------------------------------------------------------
function BuscarSocio({ sesion, refrescar, onListo, onError }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState(null)

  useEffect(() => {
    const texto = q.trim()
    if (texto.length === 1) return
    let vigente = true
    const t = setTimeout(() => {
      api.adminBuscar(sesion.token, texto).then((r) => vigente && setRes(r)).catch(onError)
    }, texto ? 300 : 0)
    return () => { vigente = false; clearTimeout(t) }
  }, [q, sesion.token, refrescar, onError])

  async function baja(s) {
    if (!window.confirm(`${s.nombre} ${s.apellido} · Socio ${s.nro}\n\n¿Dar de baja el carnet de tenis? Ya no va a poder reservar.`)) return
    try {
      const r = await api.adminBaja(sesion.token, s.nro)
      onListo(`${r.nombre} (socio ${r.nro}) quedó sin carnet de tenis.`)
    } catch (err) { onError(err) }
  }

  const sinBusqueda = q.trim() === ''

  return (
    <Tarjeta titulo="Buscar socio" sub="Por nombre, apellido, número de socio o DNI.">
      <input aria-label="Buscar socio" placeholder="Ej. Pérez, 41400 o 24760115" value={q} onChange={(e) => setQ(e.target.value)}
        className="h-11 rounded-xl border-[1.5px] border-borde bg-white px-3 text-base outline-none focus:border-verde" />
      {res === null ? <Cargando /> : (
        <>
          {sinBusqueda && <span className="text-[13px] font-bold text-gris">Altas manuales que todavía no llegaron en el Excel</span>}
          {res.length === 0 && (
            <p className="text-[15px] text-gris">{sinBusqueda ? 'No hay altas manuales pendientes.' : 'No encontramos socios con esa búsqueda.'}</p>
          )}
          <ul className="flex max-h-96 flex-col overflow-y-auto">
            {res.map((s) => (
              <li key={s.nro} className="flex items-center justify-between gap-3 border-b border-borde py-2.5 last:border-0">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[15px] font-bold">{s.nombre} {s.apellido}</span>
                  <span className="text-[13px] text-gris">
                    Socio {s.nro} · DNI {s.dni}{s.prueba ? ' · de prueba' : ''}
                    {s.origen === 'manual' && s.carnet ? ` · alta manual ${s.alta_manual_en ? momento(s.alta_manual_en) : ''}` : ''}
                  </span>
                  <span className={`truncate text-[13px] ${s.mail_ok ? 'text-gris' : 'text-[#9a3412]'}`}>
                    {s.email ? (s.mail_ok ? s.email : `${s.email} (incompleto)`) : 'Sin mail'}
                  </span>
                </span>
                {s.carnet ? (
                  <button onClick={() => baja(s)} className="min-h-11 shrink-0 rounded-lg border-[1.5px] border-error px-3 text-sm font-bold text-error hover:bg-[#fdf3f2]">
                    Dar de baja
                  </button>
                ) : (
                  <span className="shrink-0 rounded-full bg-apagado px-3 py-1 text-[13px] font-bold text-gris">Sin carnet</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Tarjeta>
  )
}
