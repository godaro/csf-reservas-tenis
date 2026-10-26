import { fechaCorta } from '../lib/fechas'
import { BotonPrincipal } from '../componentes/ui'

export default function Confirmada({ resumen, onVerMis }) {
  const filas = [
    ['Día', fechaCorta(resumen.fecha)],
    ['Horario', resumen.rango],
    ['Cancha', `Cancha ${resumen.cancha}`],
    ['Partido', resumen.tipo === 'single' ? 'Single' : 'Dobles'],
    ['Con', resumen.jugadores.join(', ')],
  ]
  return (
    <div className="flex flex-col gap-5 pt-3">
      <div className="flex size-16 items-center justify-center self-center rounded-full bg-verde-claro">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="text-verde" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </div>
      <h1 className="text-center font-display text-3xl font-semibold">¡Reserva confirmada!</h1>
      <dl className="flex flex-col gap-2.5 rounded-2xl border border-borde bg-white p-4">
        {filas.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4">
            <dt className="text-gris">{k}</dt>
            <dd className="text-right font-bold">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-center text-[15px] text-gris">¡Que lo disfruten! Si no pueden ir, cancelala así otro socio aprovecha la cancha.</p>
      <BotonPrincipal onClick={onVerMis}>Ver mis reservas</BotonPrincipal>
    </div>
  )
}
