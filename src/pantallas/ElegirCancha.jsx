import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { fechaCorta, hora } from '../lib/fechas'
import { Aviso, Titulo, Volver } from '../componentes/ui'

export default function ElegirCancha({ sesion, reserva, onElegir, onVolver, onSlot, onError }) {
  const { fecha, tipo, slot } = reserva
  const [actualizando, setActualizando] = useState(true)

  // Cada vez que se entra, se vuelve a consultar qué canchas siguen libres a esa hora
  useEffect(() => {
    let vigente = true
    api.disponibilidad(sesion.token, fecha, tipo)
      .then((d) => {
        if (!vigente) return
        const nuevo = d.slots.find((s) => s.hora === slot.hora)
        if (nuevo) onSlot(nuevo)
        else onSlot({ ...slot, libres: [], ocupadas: slot.libres.concat(slot.ocupadas.map((o) => o.cancha)).map((c) => ({ cancha: c, motivo: 'No disponible' })) })
      })
      .catch((e) => e.codigo === 'SESION' && onError(e))
      .finally(() => vigente && setActualizando(false))
    return () => { vigente = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sesion.token, fecha, tipo, slot.hora])
  const minutos = tipo === 'single' ? 60 : 90
  const fin = new Date(new Date(slot.inicio).getTime() + minutos * 60000).toISOString()
  const terminaTarde = Number(hora(fin).slice(0, 2)) >= 19

  const ocupadas = Object.fromEntries(slot.ocupadas.map((o) => [o.cancha, o.motivo]))
  const canchas = [...slot.libres, ...slot.ocupadas.map((o) => o.cancha)].sort((a, b) => a - b)

  return (
    <div className="flex flex-col gap-4">
      <Volver onClick={onVolver}>Cambiar horario</Volver>
      <Titulo sub={`${fechaCorta(fecha)} · ${slot.hora} a ${hora(fin)} · ${tipo === 'single' ? 'Single' : 'Dobles'}`}>
        Elegí la cancha
      </Titulo>

      {!actualizando && slot.libres.length === 0 && (
        <Aviso tipo="alerta">Ya no quedan canchas libres a esa hora. Elegí otro horario.</Aviso>
      )}
      {terminaTarde && <Aviso>A esa hora probablemente necesites luz: se abona con ficha en la cancha.</Aviso>}

      <div className="grid gap-2 sm:grid-cols-2">
        {canchas.map((n) =>
          ocupadas[n] ? (
            <div key={n} className="flex min-h-13 items-center justify-between rounded-xl bg-apagado px-4 text-gris">
              <span className="text-[17px] font-bold">Cancha {n}</span>
              <span className="text-sm">{ocupadas[n]}</span>
            </div>
          ) : (
            <button
              key={n}
              onClick={() => onElegir(n)}
              className="flex min-h-13 items-center justify-between rounded-xl border-[1.5px] border-borde bg-white px-4 text-tinta transition hover:border-verde"
            >
              <span className="text-[17px] font-bold">Cancha {n}</span>
              <span className="text-sm font-bold text-verde">Elegir ›</span>
            </button>
          ),
        )}
      </div>
    </div>
  )
}
