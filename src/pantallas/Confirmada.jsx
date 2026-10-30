import { fechaCorta, fechaLarga } from '../lib/fechas'
import { BotonPrincipal } from '../componentes/ui'
import { evento } from '../lib/analitica'

// Mensaje listo para que el socio lo mande él mismo (sin costo para el Club)
function mensajeWhatsApp(r) {
  const partido = r.tipo === 'single' ? 'single' : 'dobles'
  const dia = fechaLarga(r.fecha)
  const horario = r.rango.replace(/\b0(\d):/g, '$1:') // "08:30 a 10:00" → "8:30 a 10:00"
  return [
    `🎾 Reservé la cancha ${r.cancha} para jugar ${partido}.`,
    `📅 ${dia.charAt(0).toUpperCase()}${dia.slice(1)}`,
    `🕘 ${horario}`,
    `👥 Jugamos: ${r.jugadores.join(', ')} y yo.`,
    '¡Nos vemos en el Club!',
  ].join('\n')
}

export default function Confirmada({ resumen, onVerMis }) {
  const filas = [
    ['Día', fechaCorta(resumen.fecha)],
    ['Horario', resumen.rango],
    ['Cancha', `Cancha ${resumen.cancha}`],
    ['Partido', resumen.tipo === 'single' ? 'Single' : 'Dobles'],
    ['Con', resumen.jugadores.join(', ')],
  ]
  const linkWhatsApp = `https://wa.me/?text=${encodeURIComponent(mensajeWhatsApp(resumen))}`

  return (
    <div className="flex flex-col gap-5 pt-3">
      <div className="flex size-16 items-center justify-center self-center rounded-full bg-verde-claro">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="text-verde" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </div>
      <h1 className="text-center font-display text-3xl font-semibold">¡Reserva confirmada!</h1>
      <dl className="flex flex-col gap-2.5 rounded-2xl border border-borde bg-superficie p-4">
        {filas.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4">
            <dt className="text-gris">{k}</dt>
            <dd className="text-right font-bold">{v}</dd>
          </div>
        ))}
      </dl>
      {resumen.invitados > 0 && (
        <p className="rounded-xl bg-alerta px-4 py-3 text-[15px] leading-snug text-alerta-texto">
          <strong>{resumen.invitados === 1 ? 'Tu invitado paga en Caja' : 'Cada invitado paga en Caja'}</strong> y
          presenta el comprobante en la Casilla de Tenis antes de jugar.
        </p>
      )}
      <a
        href={linkWhatsApp}
        onClick={() => evento('compartir_whatsapp')}
        target="_blank"
        rel="noopener noreferrer"
        className="flex h-13 items-center justify-center gap-2 rounded-xl border-[1.5px] border-wa bg-superficie text-[17px] font-bold text-wa transition hover:bg-wa-claro"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.6-.3Z" />
        </svg>
        Avisar por WhatsApp
      </a>
      <p className="text-center text-[15px] text-gris">¡Que lo disfruten! Si no pueden ir, cancelala así otro socio aprovecha la cancha.</p>
      <BotonPrincipal onClick={onVerMis}>Ver mis reservas</BotonPrincipal>
    </div>
  )
}
