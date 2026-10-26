import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { fechaCorta, hora, JUGADORES_EXTRA, MINUTOS } from '../lib/fechas'
import { Aviso, BotonPrincipal, Campo, Cargando, Titulo, Volver } from '../componentes/ui'

const NOTAS = {
  ok: 'Carnet de tenis vigente',
  con_reserva: 'Ya tiene una reserva activa',
  sin_carnet: 'Sin carnet de tenis vigente',
}

export default function Jugadores({ sesion, reserva, onConfirmada, onVolver, onOcupada, onError }) {
  const { fecha, tipo, slot, cancha } = reserva
  const necesarios = JUGADORES_EXTRA[tipo]
  const fin = new Date(new Date(slot.inicio).getTime() + MINUTOS[tipo] * 60000).toISOString()

  const [q, setQ] = useState('')
  const [resultados, setResultados] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [elegidos, setElegidos] = useState([])
  const [error, setError] = useState(null)
  const [enviando, setEnviando] = useState(false)

  // Búsqueda con una pequeña espera para no consultar en cada tecla
  useEffect(() => {
    const texto = q.trim()
    if (texto.length < 2) { setResultados([]); return }
    setBuscando(true)
    const t = setTimeout(() => {
      api.buscarSocios(sesion.token, texto)
        .then(setResultados)
        .catch((e) => (e.codigo === 'SESION' ? onError(e) : setError({ texto: e.message })))
        .finally(() => setBuscando(false))
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, sesion.token])

  const elegido = (nro) => elegidos.some((e) => e.nro === nro)
  const completo = elegidos.length === necesarios
  const faltan = necesarios - elegidos.length

  function alternar(s) {
    if (elegido(s.nro)) setElegidos(elegidos.filter((e) => e.nro !== s.nro))
    else if (s.estado === 'ok' && !completo) {
      setElegidos([...elegidos, { nro: s.nro, nombre: s.nombre }])
      setQ('')
    }
  }

  async function confirmar() {
    setError(null)
    setEnviando(true)
    try {
      await api.reservar(sesion.token, cancha, slot.inicio, tipo, elegidos.map((e) => e.nro))
      onConfirmada({
        fecha, cancha, tipo,
        rango: `${slot.hora} a ${hora(fin)}`,
        jugadores: elegidos.map((e) => e.nombre),
      })
    } catch (e) {
      if (e.codigo === 'SESION') onError(e)
      else setError({ texto: e.message, ocupada: e.codigo === 'OCUPADA' })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-24">
      <Volver onClick={onVolver}>Cambiar cancha</Volver>
      <Titulo sub={`${fechaCorta(fecha)} · ${slot.hora} a ${hora(fin)} · Cancha ${cancha}`}>¿Con quién jugás?</Titulo>

      <div className="flex flex-col gap-2 rounded-xl border border-borde bg-white p-3.5">
        <span className="text-[13px] font-bold text-gris">
          Jugadores ({elegidos.length + 1} de {necesarios + 1})
        </span>
        <div className="flex flex-wrap gap-1.5">
          <span className="inline-flex min-h-8 items-center rounded-full bg-verde px-3 text-sm font-bold text-white">
            Vos (titular)
          </span>
          {elegidos.map((e) => (
            <button
              key={e.nro}
              onClick={() => alternar(e)}
              aria-label={`Quitar a ${e.nombre}`}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-verde-claro pl-3 pr-2.5 text-sm font-bold text-verde-oscuro"
            >
              {e.nombre} <span aria-hidden="true">✕</span>
            </button>
          ))}
        </div>
      </div>

      {!completo && (
        <Campo id="buscar" label="Buscar socio con carnet de tenis" placeholder="Nombre, apellido o número de socio"
          value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      )}

      {buscando && <Cargando texto="Buscando…" />}

      {!completo && !buscando && q.trim().length >= 2 && resultados.length === 0 && (
        <p className="text-[15px] text-gris">No encontramos socios con ese nombre o número.</p>
      )}

      {!completo && resultados.length > 0 && (
        <div className="flex flex-col gap-2">
          {resultados.map((s) => {
            const puede = s.estado === 'ok' && !elegido(s.nro)
            return (
              <button
                key={s.nro}
                disabled={!puede}
                onClick={() => alternar(s)}
                className={`flex min-h-15 items-center justify-between gap-3 rounded-xl border-[1.5px] px-3.5 py-2 text-left ${
                  puede ? 'border-borde bg-white text-tinta hover:border-verde' : 'border-apagado bg-apagado text-gris'
                }`}
              >
                <span className="flex flex-col gap-0.5">
                  <span className="text-base font-bold">{s.nombre}</span>
                  <span className={`text-[13px] ${s.estado === 'ok' ? 'text-gris' : 'text-[#9a3412]'}`}>
                    Socio {s.nro} · {elegido(s.nro) ? 'Ya está en el partido' : NOTAS[s.estado]}
                  </span>
                </span>
                {puede && <span className="text-sm font-bold text-verde">Sumar</span>}
              </button>
            )
          })}
        </div>
      )}

      {error && (
        <Aviso tipo="error">
          {error.texto}
          {error.ocupada && (
            <button onClick={onOcupada} className="mt-1 block min-h-11 font-bold underline">
              Ver canchas libres
            </button>
          )}
        </Aviso>
      )}

      <div className="fixed inset-x-0 bottom-[68px] z-10 border-t border-borde bg-white px-5 py-3">
        <div className="mx-auto max-w-xl">
          <BotonPrincipal disabled={!completo || enviando} onClick={confirmar}>
            {enviando ? 'Reservando…' : completo ? 'Confirmar reserva'
              : faltan === 1 ? 'Sumá 1 jugador más' : `Sumá ${faltan} jugadores más`}
          </BotonPrincipal>
        </div>
      </div>
    </div>
  )
}
