import { useCallback, useEffect, useState } from 'react'
import { api, configurado, ES_ADMIN, ES_MANT, ES_PANEL, ROL_RUTA, guardarSesion, leerSesion } from './lib/api'
import Login from './pantallas/Login'
import Agenda from './pantallas/Agenda'
import ElegirCancha from './pantallas/ElegirCancha'
import Jugadores from './pantallas/Jugadores'
import Confirmada from './pantallas/Confirmada'
import MisReservas from './pantallas/MisReservas'
import Capitania from './pantallas/Capitania'
import Admin from './pantallas/Admin'
import Mantenimiento from './pantallas/Mantenimiento'
import { Aviso } from './componentes/ui'
import { JUGADORES_EXTRA } from './lib/fechas'
import MiMail from './componentes/MiMail'
import BotonTema from './componentes/BotonTema'
import { evento, vista } from './lib/analitica'

export default function App() {
  const [sesion, setSesion] = useState(leerSesion)
  const [pantalla, setPantalla] = useState('agenda')
  const [seleccion, setSeleccion] = useState({ fecha: null, tipo: 'single' })
  const [reserva, setReserva] = useState(null) // { fecha, tipo, slot, cancha, jugadores }
  const [resumen, setResumen] = useState(null)
  const [aviso, setAviso] = useState('')

  const ir = (p) => { setAviso(''); setPantalla(p); window.scrollTo(0, 0) }

  // Analytics: una "página" por pantalla (sin datos personales)
  const rolSesion = sesion && sesion.rol === ROL_RUTA ? sesion.rol : null
  useEffect(() => {
    if (ES_MANT) vista(rolSesion ? '/mantenimiento/encargado' : '/mantenimiento', 'Mantenimiento')
    else if (ES_ADMIN) vista(rolSesion ? '/admin' : '/admin/ingreso', 'Administración')
    else if (ES_PANEL) vista(rolSesion ? '/capitania' : '/capitania/ingreso', 'Panel de Capitanía')
    else if (!rolSesion) vista('/ingreso', 'Ingreso')
    else vista(...({
      agenda: ['/reservar', 'Reservar'], cancha: ['/reservar/cancha', 'Elegir cancha'],
      jugadores: ['/reservar/jugadores', 'Compañeros'], ok: ['/reservar/confirmada', 'Reserva confirmada'],
      mis: ['/mis-reservas', 'Mis reservas'],
    }[pantalla] ?? ['/reservar', 'Reservar']))
  }, [pantalla, rolSesion])

  function ingresar(s) {
    evento('login', { method: s.rol === 'socio' ? 'socio_dni' : 'usuario_clave' })
    guardarSesion(s)
    setSesion(s)
    ir('agenda')
  }

  function salir() {
    if (sesion) api.logout(sesion.token).catch(() => {})
    guardarSesion(null)
    setSesion(null)
    setPantalla('agenda')
  }

  // Si la sesión venció, volvemos al login con un aviso
  const onError = useCallback((e) => {
    if (e.codigo === 'SESION') {
      guardarSesion(null)
      setSesion(null)
      setPantalla('agenda')
    }
    setAviso(e.message)
  }, [])

  if (!configurado) {
    return (
      <Marco>
        <Aviso tipo="alerta">
          Falta configurar la conexión con Supabase: copiá <code>.env.example</code> como <code>.env</code> y completá la URL y la clave pública del proyecto.
        </Aviso>
      </Marco>
    )
  }

  // Mantenimiento: la grilla es pública; el encargado ingresa para bloquear
  if (ES_MANT) {
    const valida = sesion && sesion.rol === 'mantenimiento' ? sesion : null
    return (
      <Marco sesion={valida} onSalir={salir} ancho panel="mantenimiento">
        <Mantenimiento sesion={valida} onIngresar={(s) => {
          if (s.rol !== 'mantenimiento') { api.logout(s.token).catch(() => {}); return 'Ese usuario no es el de mantenimiento.' }
          guardarSesion(s); setSesion(s); return null
        }} onError={onError} aviso={aviso} />
      </Marco>
    )
  }

  // Una sesión solo vale en su lugar: socios en "/", Capitanía en "/capitania", Administración en "/admin"
  const sesionValida = sesion && sesion.rol === ROL_RUTA ? sesion : null
  const panel = ES_ADMIN ? 'admin' : ES_PANEL ? 'capitania' : null

  if (!sesionValida) {
    return (
      <Marco ancho={!!panel} panel={panel}>
        {aviso && <div className="mx-auto mb-4 max-w-md"><Aviso tipo="alerta">{aviso}</Aviso></div>}
        <Login onIngresar={(s) => (s.rol === ROL_RUTA ? ingresar(s) : setAviso(
          ROL_RUTA === 'admin' ? 'Ese usuario no es de Administración.' : 'Ese usuario no es de la Capitanía. Administración entra en /admin.'))}
          modo={panel ?? 'socio'} />
      </Marco>
    )
  }

  // Administración: solo la sección Socios
  if (ES_ADMIN) {
    return (
      <Marco sesion={sesion} onSalir={salir} ancho panel="admin">
        {aviso && <div className="mb-4"><Aviso tipo="error">{aviso}</Aviso></div>}
        <Admin sesion={sesion} onError={onError} />
      </Marco>
    )
  }

  // Panel de Capitanía: solo administra, sin pestañas de reserva
  if (ES_PANEL) {
    return (
      <Marco sesion={sesion} onSalir={salir} ancho panel="capitania">
        {aviso && <div className="mb-4"><Aviso tipo="error">{aviso}</Aviso></div>}
        <Capitania sesion={sesion} onError={onError} />
      </Marco>
    )
  }

  const tabs = [
    ['agenda', 'Reservar', IconoCalendario],
    ['mis', 'Mis reservas', IconoCheck],
  ]
  const tabActiva = ['cancha', 'jugadores', 'ok'].includes(pantalla) ? 'agenda' : pantalla

  return (
    <Marco sesion={sesion} onSalir={salir}
      tabs={tabs} tabActiva={tabActiva} onTab={(t) => ir(t)}>
      {aviso && <div className="mb-4"><Aviso tipo="error">{aviso}</Aviso></div>}
      {pantalla === 'agenda' && <MiMail key={sesion.token} sesion={sesion} onError={onError} />}

      {pantalla === 'agenda' && (
        <Agenda sesion={sesion} seleccion={seleccion} setSeleccion={setSeleccion} onError={onError}
          onVerMis={() => ir('mis')}
          onElegirHorario={(slot, disp) => {
            // Si ya había elegido compañeros, se conservan (recortados si pasó de dobles a single)
            setReserva((r) => ({ fecha: disp.fecha, tipo: disp.tipo, slot, jugadores: (r?.jugadores ?? []).slice(0, JUGADORES_EXTRA[disp.tipo]) }))
            ir('cancha')
          }} />
      )}
      {pantalla === 'cancha' && reserva && (
        <ElegirCancha sesion={sesion} reserva={reserva} onVolver={() => ir('agenda')} onError={onError}
          onSlot={(slot) => setReserva((r) => ({ ...r, slot }))}
          onElegir={(cancha) => { setReserva((r) => ({ ...r, cancha })); ir('jugadores') }} />
      )}
      {pantalla === 'jugadores' && reserva && (
        <Jugadores sesion={sesion} reserva={reserva} onError={onError}
          onJugadores={(jugadores) => setReserva((r) => ({ ...r, jugadores }))}
          onVolver={() => ir('cancha')} onOcupada={() => ir('agenda')}
          onConfirmada={(r) => { evento('reserva_confirmada', { tipo_partido: r.tipo, cancha: r.cancha }); setResumen(r); setReserva(null); ir('ok') }} />
      )}
      {pantalla === 'ok' && resumen && <Confirmada resumen={resumen} onVerMis={() => ir('mis')} />}
      {pantalla === 'mis' && <MisReservas sesion={sesion} onError={onError} onReservar={() => ir('agenda')} />}
    </Marco>
  )
}

function Marco({ children, sesion, onSalir, tabs, tabActiva, onTab, ancho, panel }) {
  if (panel) document.title = `${panel === 'mantenimiento' ? 'Canchas · Mantenimiento' : panel === 'admin' ? 'Administración' : 'Panel de Capitanía'} · Reservas de Tenis`
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex h-1 shrink-0" aria-hidden="true">
        <div className="flex-1 bg-verde" /><div className="flex-1 bg-[#fff]" /><div className="flex-1 bg-azul" />
      </div>
      <header className="border-b border-borde bg-superficie">
        <div className={`mx-auto flex items-center gap-3 px-5 py-3 ${ancho ? 'max-w-6xl' : 'max-w-xl'}`}>
          <img src="/escudo.svg" alt="Escudo del Club San Fernando" width="34" height="42" className="h-[42px] w-[34px] shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-[11px] font-bold tracking-[0.12em] text-verde">CLUB SAN FERNANDO{panel === 'mantenimiento' ? ' · MANTENIMIENTO' : panel === 'admin' ? ' · ADMINISTRACIÓN' : panel ? ' · CAPITANÍA' : ''}</span>
            <span className="whitespace-nowrap font-display text-[19px] font-semibold leading-tight min-[400px]:text-[22px]">Reservas de Tenis</span>
          </div>
          <BotonTema />
          {sesion && (
            <div className="flex flex-col items-end">
              <span className="max-w-28 truncate text-[13px] sm:max-w-36 text-gris">{sesion.nombre}</span>
              <button onClick={onSalir} className="min-h-8 text-[13px] font-bold text-verde">Salir</button>
            </div>
          )}
        </div>
      </header>

      <main className={`mx-auto w-full flex-1 px-5 pt-5 ${tabs ? 'pb-[calc(7rem+env(safe-area-inset-bottom))]' : 'pb-10'} ${ancho ? 'max-w-6xl' : 'max-w-xl'}`}>{children}</main>

      {tabs && (
        <nav aria-label="Secciones" className="fixed inset-x-0 bottom-0 z-20 border-t border-borde bg-superficie pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto flex max-w-xl">
            {tabs.map(([id, texto, Icono]) => (
              <button key={id} onClick={() => onTab(id)} aria-current={tabActiva === id ? 'page' : undefined}
                className={`flex min-h-[68px] flex-1 flex-col items-center justify-center gap-0.5 text-xs font-bold ${tabActiva === id ? 'text-verde' : 'text-gris'}`}>
                <Icono />{texto}
              </button>
            ))}
          </div>
        </nav>
      )}
    </div>
  )
}

const svg = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
function IconoCalendario() {
  return <svg {...svg}><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
}
function IconoCheck() {
  return <svg {...svg}><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.8 2.8L16.5 9.5" /></svg>
}
