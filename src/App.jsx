import { useCallback, useState } from 'react'
import { api, configurado, guardarSesion, leerSesion } from './lib/api'
import Login from './pantallas/Login'
import Agenda from './pantallas/Agenda'
import ElegirCancha from './pantallas/ElegirCancha'
import Jugadores from './pantallas/Jugadores'
import Confirmada from './pantallas/Confirmada'
import MisReservas from './pantallas/MisReservas'
import Capitania from './pantallas/Capitania'
import { Aviso } from './componentes/ui'

export default function App() {
  const [sesion, setSesion] = useState(leerSesion)
  const [pantalla, setPantalla] = useState('agenda')
  const [seleccion, setSeleccion] = useState({ fecha: null, tipo: 'single' })
  const [reserva, setReserva] = useState(null) // { fecha, tipo, slot, cancha }
  const [resumen, setResumen] = useState(null)
  const [aviso, setAviso] = useState('')

  const ir = (p) => { setAviso(''); setPantalla(p); window.scrollTo(0, 0) }

  function ingresar(s) {
    guardarSesion(s)
    setSesion(s)
    ir(s.rol === 'capitania' ? 'capitania' : 'agenda')
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

  if (!sesion) {
    return (
      <Marco>
        {aviso && <div className="mb-4"><Aviso tipo="alerta">{aviso}</Aviso></div>}
        <Login onIngresar={ingresar} />
      </Marco>
    )
  }

  const tabs = [
    ['agenda', 'Reservar', IconoCalendario],
    ['mis', 'Mis reservas', IconoCheck],
    ...(sesion.rol === 'capitania' ? [['capitania', 'Capitanía', IconoGrilla]] : []),
  ]
  const tabActiva = ['cancha', 'jugadores', 'ok'].includes(pantalla) ? 'agenda' : pantalla

  return (
    <Marco sesion={sesion} onSalir={salir} ancho={pantalla === 'capitania'}
      tabs={tabs} tabActiva={tabActiva} onTab={(t) => ir(t)}>
      {aviso && <div className="mb-4"><Aviso tipo="error">{aviso}</Aviso></div>}

      {pantalla === 'agenda' && (
        <Agenda sesion={sesion} seleccion={seleccion} setSeleccion={setSeleccion} onError={onError}
          onVerMis={() => ir('mis')}
          onElegirHorario={(slot, disp) => { setReserva({ fecha: disp.fecha, tipo: disp.tipo, slot }); ir('cancha') }} />
      )}
      {pantalla === 'cancha' && reserva && (
        <ElegirCancha reserva={reserva} onVolver={() => ir('agenda')}
          onElegir={(cancha) => { setReserva({ ...reserva, cancha }); ir('jugadores') }} />
      )}
      {pantalla === 'jugadores' && reserva && (
        <Jugadores sesion={sesion} reserva={reserva} onError={onError}
          onVolver={() => ir('cancha')} onOcupada={() => ir('agenda')}
          onConfirmada={(r) => { setResumen(r); ir('ok') }} />
      )}
      {pantalla === 'ok' && resumen && <Confirmada resumen={resumen} onVerMis={() => ir('mis')} />}
      {pantalla === 'mis' && <MisReservas sesion={sesion} onError={onError} onReservar={() => ir('agenda')} />}
      {pantalla === 'capitania' && sesion.rol === 'capitania' && <Capitania sesion={sesion} onError={onError} />}
    </Marco>
  )
}

function Marco({ children, sesion, onSalir, tabs, tabActiva, onTab, ancho }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex h-1 shrink-0" aria-hidden="true">
        <div className="flex-1 bg-verde" /><div className="flex-1 bg-white" /><div className="flex-1 bg-azul" />
      </div>
      <header className="border-b border-borde bg-white">
        <div className={`mx-auto flex items-center gap-3 px-5 py-3 ${ancho ? 'max-w-6xl' : 'max-w-xl'}`}>
          <svg width="34" height="34" viewBox="0 0 34 34" fill="none" aria-hidden="true" className="shrink-0">
            <circle cx="17" cy="17" r="15" stroke="#09582D" strokeWidth="2.2" />
            <path d="M5 9c5 3 7 9 5 17M29 9c-5 3-7 9-5 17" stroke="#18305B" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-[11px] font-bold tracking-[0.12em] text-verde">CLUB SAN FERNANDO</span>
            <span className="font-display text-[22px] font-semibold leading-tight">Reservas de Tenis</span>
          </div>
          {sesion && (
            <div className="flex flex-col items-end">
              <span className="max-w-36 truncate text-[13px] text-gris">{sesion.nombre}</span>
              <button onClick={onSalir} className="min-h-8 text-[13px] font-bold text-verde">Salir</button>
            </div>
          )}
        </div>
      </header>

      <main className={`mx-auto w-full flex-1 px-5 pb-28 pt-5 ${ancho ? 'max-w-6xl' : 'max-w-xl'}`}>{children}</main>

      {tabs && (
        <nav aria-label="Secciones" className="fixed inset-x-0 bottom-0 z-20 border-t border-borde bg-white pb-[env(safe-area-inset-bottom)]">
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
function IconoGrilla() {
  return <svg {...svg}><rect x="3.5" y="3.5" width="17" height="17" rx="2" /><path d="M3.5 9.5h17M3.5 14.5h17M9.5 3.5v17M14.5 3.5v17" /></svg>
}
