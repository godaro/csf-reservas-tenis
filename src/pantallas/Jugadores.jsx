import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { fechaCorta, hora, JUGADORES_EXTRA, MINUTOS } from '../lib/fechas'
import { Aviso, BotonPrincipal, Campo, Cargando, Titulo, Volver } from '../componentes/ui'

const NOTAS = {
  con_reserva: 'Ya tiene el máximo de reservas',
  muy_cerca: 'Tiene otra reserva muy cerca de este horario',
  sin_carnet: 'Sin carnet de tenis vigente',
}

export default function Jugadores({ sesion, reserva, onJugadores, onConfirmada, onVolver, onOcupada, onError }) {
  const { fecha, tipo, slot, cancha } = reserva
  const necesarios = JUGADORES_EXTRA[tipo]
  const fin = new Date(new Date(slot.inicio).getTime() + MINUTOS[tipo] * 60000).toISOString()

  const [q, setQ] = useState('')
  const [resultados, setResultados] = useState([])
  const [buscando, setBuscando] = useState(false)
  // Los compañeros elegidos se guardan en la reserva: no se pierden al cambiar de cancha
  const elegidos = reserva.jugadores ?? []
  const setElegidos = onJugadores
  const [error, setError] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const [canchaActual, setCanchaActual] = useState(cancha)
  // Si te ganan la cancha: otras canchas libres en el mismo horario (null = no aplica)
  const [alternativas, setAlternativas] = useState(null)

  // Invitados no socios: pueden completar el partido (siempre juega al menos el socio que reserva),
  // solo en las franjas que define el Club
  const [reglas, setReglas] = useState(null) // { permitido, texto }
  const [formInv, setFormInv] = useState(null) // { nombre, apellido, dni } mientras se carga
  const invitados = elegidos.filter((e) => e.invitado)
  useEffect(() => {
    api.invitadosReglas(sesion.token, slot.inicio, fin).then((r) => {
      setReglas(r)
      // Si cambió el horario y ahí no se admiten invitados, se saca el que estaba
      if (!r.permitido && elegidos.some((e) => e.invitado)) setElegidos(elegidos.filter((e) => !e.invitado))
    }).catch(() => setReglas(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sesion.token, slot.inicio])

  function agregarInvitado(e) {
    e.preventDefault()
    const nombre = formInv.nombre.trim()
    const apellido = formInv.apellido.trim()
    const dni = formInv.dni.replace(/\D/g, '')
    if (!nombre || !apellido) return setError({ texto: 'Completá nombre y apellido del invitado.' })
    if (dni.length < 6) return setError({ texto: 'El DNI del invitado no es válido.' })
    if (invitados.some((i) => i.datos.dni === dni)) return setError({ texto: 'Ya sumaste a un invitado con ese DNI.' })
    setError(null)
    setElegidos([...elegidos, { nro: `invitado-${dni}`, invitado: true, nombre: `${nombre} ${apellido}`, datos: { nombre, apellido, dni } }])
    setFormInv(null)
  }

  // Compañeros frecuentes (si falla, simplemente no se muestran)
  const [frecuentes, setFrecuentes] = useState([])
  useEffect(() => {
    api.frecuentes(sesion.token, slot.inicio, fin).then(setFrecuentes).catch(() => setFrecuentes([]))
  }, [sesion.token])

  // Búsqueda con una pequeña espera para no consultar en cada tecla
  useEffect(() => {
    const texto = q.trim()
    if (texto.length < 2) { setResultados([]); return }
    setBuscando(true)
    const t = setTimeout(() => {
      api.buscarSocios(sesion.token, texto, slot.inicio, fin)
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

  async function confirmar(n = canchaActual) {
    setError(null)
    setAlternativas(null)
    setCanchaActual(n)
    setEnviando(true)
    try {
      await api.reservar(sesion.token, n, slot.inicio, tipo,
        elegidos.filter((e) => !e.invitado).map((e) => e.nro), invitados.length ? invitados.map((i) => i.datos) : null)
      onConfirmada({
        fecha, cancha: n, tipo,
        rango: `${slot.hora} a ${hora(fin)}`,
        jugadores: elegidos.map((e) => (e.invitado ? `${e.nombre} (invitado)` : e.nombre)),
        invitados: invitados.length,
      })
    } catch (e) {
      if (e.codigo === 'SESION') return onError(e)
      setError({ texto: e.message, ocupada: e.codigo === 'OCUPADA' })
      if (e.codigo === 'OCUPADA') {
        // Buscamos qué otras canchas siguen libres a esa misma hora
        try {
          const d = await api.disponibilidad(sesion.token, fecha, tipo)
          const mismo = d.slots.find((s) => s.hora === slot.hora)
          setAlternativas(mismo ? mismo.libres : [])
        } catch {
          setAlternativas([])
        }
      }
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-24">
      <Volver onClick={onVolver}>Cambiar cancha</Volver>
      <Titulo sub={`${fechaCorta(fecha)} · ${slot.hora} a ${hora(fin)} · Cancha ${canchaActual}`}>¿Con quién jugás?</Titulo>

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
              {e.nombre}{e.invitado ? ' (invitado)' : ''} <span aria-hidden="true">✕</span>
            </button>
          ))}
        </div>
      </div>

      {!completo && frecuentes.some((f) => !elegido(f.nro)) && (
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-bold text-gris">Jugaste con</span>
          <div className="flex flex-wrap gap-2">
            {frecuentes.filter((f) => !elegido(f.nro)).map((f) => {
              const puede = f.estado === 'ok'
              return (
                <button
                  key={f.nro}
                  disabled={!puede}
                  onClick={() => alternar(f)}
                  title={f.estado !== 'ok' ? NOTAS[f.estado] : undefined}
                  aria-label={puede ? `Sumar a ${f.nombre}` : `${f.nombre}: ${NOTAS[f.estado]}`}
                  className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border-[1.5px] px-3.5 text-[15px] font-bold transition ${
                    puede
                      ? 'border-verde bg-white text-verde hover:bg-verde-claro'
                      : 'border-apagado bg-apagado text-gris line-through decoration-1'
                  }`}
                >
                  {puede && <span aria-hidden="true">+</span>}
                  {f.nombre}
                </button>
              )
            })}
          </div>
          {frecuentes.some((f) => f.estado !== 'ok') && (
            <p className="text-[12px] text-gris">Tachados: ya tienen el máximo de reservas, otra reserva muy cerca de este horario o el carnet no vigente.</p>
          )}
        </div>
      )}

      {!completo && (
        <Campo id="buscar" label="Buscar socio con carnet de tenis" placeholder="Nombre, apellido o número de socio"
          value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      )}

      {!completo && reglas && (
        reglas.permitido ? (
          formInv ? (
            <form onSubmit={agregarInvitado} className="flex flex-col gap-3 rounded-xl border border-borde bg-white p-3.5">
              <span className="text-[15px] font-bold">{invitados.length ? 'Otro invitado no socio' : 'Invitado no socio'}</span>
              <div className="grid grid-cols-2 gap-2">
                <Campo id="inv-nombre" label="Nombre" autoComplete="off" value={formInv.nombre}
                  onChange={(e) => setFormInv({ ...formInv, nombre: e.target.value })} />
                <Campo id="inv-apellido" label="Apellido" autoComplete="off" value={formInv.apellido}
                  onChange={(e) => setFormInv({ ...formInv, apellido: e.target.value })} />
              </div>
              <Campo id="inv-dni" label="DNI (sin puntos)" inputMode="numeric" autoComplete="off" value={formInv.dni}
                onChange={(e) => setFormInv({ ...formInv, dni: e.target.value })} />
              <p className="text-[13px] leading-snug text-gris">Paga en Caja y presenta el comprobante en la Casilla de Tenis antes de jugar.</p>
              <div className="flex gap-2">
                <button className="min-h-11 rounded-xl bg-verde px-4 text-[15px] font-bold text-white hover:bg-verde-oscuro">Sumar invitado</button>
                <button type="button" onClick={() => setFormInv(null)} className="min-h-11 rounded-xl px-3 text-[15px] font-bold text-gris">Cancelar</button>
              </div>
            </form>
          ) : (
            <button onClick={() => { setError(null); setFormInv({ nombre: '', apellido: '', dni: '' }) }}
              className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-full border-[1.5px] border-dashed border-verde px-3.5 text-[15px] font-bold text-verde hover:bg-verde-claro">
              <span aria-hidden="true">+</span> Sumar invitado no socio
            </button>
          )
        ) : (
          <p className="text-[13px] leading-snug text-gris">Los invitados no socios solo pueden jugar {reglas.texto}.</p>
        )
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
                    Socio {s.nro}{elegido(s.nro) ? ' · Ya está en el partido' : s.estado !== 'ok' ? ` · ${NOTAS[s.estado]}` : ''}
                  </span>
                </span>
                {puede && <span className="text-sm font-bold text-verde">Sumar</span>}
              </button>
            )
          })}
        </div>
      )}

      {error && !error.ocupada && <Aviso tipo="error">{error.texto}</Aviso>}

      {error?.ocupada && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-[#f2d3a6] bg-[#fff4e5] p-4">
          <span className="text-[15px] leading-snug text-[#4a3a22]">
            <strong className="block">Te ganaron la cancha {canchaActual}</strong>
            {alternativas === null
              ? 'Buscando otras canchas libres a la misma hora…'
              : alternativas.length > 0
                ? `Estas siguen libres a las ${slot.hora}. Tocá una y la reservamos con los mismos jugadores:`
                : `No quedan canchas libres a las ${slot.hora}.`}
          </span>
          {alternativas?.length > 0 && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {alternativas.map((n) => (
                <button key={n} onClick={() => confirmar(n)} disabled={enviando}
                  className="min-h-12 rounded-xl border-[1.5px] border-verde bg-white font-bold text-verde hover:bg-verde-claro disabled:opacity-60">
                  Cancha {n}
                </button>
              ))}
            </div>
          )}
          {alternativas?.length === 0 && (
            <button onClick={onOcupada} className="min-h-11 self-start font-bold text-[#8a4b00] underline">
              Ver otros horarios
            </button>
          )}
        </div>
      )}

      <div className="fixed inset-x-0 bottom-[calc(68px+env(safe-area-inset-bottom))] z-10 border-t border-borde bg-white px-5 py-3">
        <div className="mx-auto max-w-xl">
          <BotonPrincipal disabled={!completo || enviando || error?.ocupada} onClick={() => confirmar()}>
            {enviando ? 'Reservando…' : error?.ocupada ? 'Elegí otra cancha' : completo ? 'Confirmar reserva'
              : faltan === 1 ? 'Sumá 1 jugador más' : `Sumá ${faltan} jugadores más`}
          </BotonPrincipal>
        </div>
      </div>
    </div>
  )
}
