// =====================================================================
// enviar-avisos · Supabase Edge Function
// Manda por mail (desde web@clubsanfernando.org.ar) los avisos de
// "reserva confirmada" y "reserva cancelada" que la base deja en la tabla
// public.avisos. La despierta la propia base al crear avisos y cada 5 minutos.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   SMTP_PASS     contraseña de web@clubsanfernando.org.ar   (obligatorio)
//   AVISOS_CLAVE  clave compartida con la base               (obligatorio)
//   SMTP_HOST     por defecto mail.clubsanfernando.org.ar
//   SMTP_USER     por defecto web@clubsanfernando.org.ar
//   APP_URL       por defecto https://reservas-tenis.netlify.app
// SUPABASE_URL y SUPABASE_SECRET_KEYS (o SUPABASE_SERVICE_ROLE_KEY) los pone Supabase solo.
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer@6.9.16'

const env = (k: string, d = '') => Deno.env.get(k) ?? d
const APP_URL = env('APP_URL', 'https://reservas-tenis.netlify.app')
const REMITENTE = env('SMTP_USER', 'web@clubsanfernando.org.ar')
const ZONA = 'America/Argentina/Buenos_Aires'

export type Aviso = {
  id: number
  tipo: 'confirmada' | 'cancelada' | 'modificada' | 'quitado'
  detalle?: string | null
  email: string
  nombre: string
  reserva_id: string
  estado_reserva: 'activa' | 'cancelada'
  cancha: number
  tipo_partido: 'single' | 'dobles'
  inicio: string
  fin: string
  fecha: string
  hora_inicio: string
  hora_fin: string
  es_titular: boolean
  yo_cancele?: boolean
  titular: string
  otros: string[] | null
  cancelada_por_capitania: boolean
  cancelo: string | null
  motivo: string | null
}

// ---------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------
const esc = (t: unknown) =>
  String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const sinCero = (h: string) => h.replace(/^0(\d):/, '$1:')

export function diaLargo(fecha: string) {
  const [y, m, d] = fecha.split('-').map(Number)
  const f = new Date(Date.UTC(y, m - 1, d, 15))
  const dia = f.toLocaleDateString('es-AR', { weekday: 'long', timeZone: ZONA })
  return `${dia.charAt(0).toUpperCase()}${dia.slice(1)} ${d}/${m}`
}

function listaNombres(ns: string[]) {
  if (ns.length <= 1) return ns.join('')
  return `${ns.slice(0, -1).join(', ')} y ${ns[ns.length - 1]}`
}

function motivoCancelacion(a: Aviso) {
  if (a.cancelada_por_capitania) {
    const m = a.motivo && a.motivo !== 'Cancelada por la Capitanía' ? ` Motivo: ${a.motivo}.` : ''
    return `La canceló la Capitanía de Tenis.${m}`
  }
  return `La canceló ${a.cancelo ?? a.titular}.`
}

// Evento de calendario (.ics) con recordatorio 2 horas antes
export function ics(a: Aviso) {
  const z = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const escIcs = (t: string) => t.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n')
  const con = a.otros?.length ? `Con ${listaNombres(a.otros)}.` : ''
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Club San Fernando//Reservas de Tenis//ES',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${a.reserva_id}@reservas-tenis.clubsanfernando.org.ar`,
    `DTSTAMP:${z(new Date().toISOString())}`,
    `DTSTART:${z(a.inicio)}`,
    `DTEND:${z(a.fin)}`,
    `SUMMARY:${escIcs(`Tenis · Cancha ${a.cancha} (${a.tipo_partido})`)}`,
    'LOCATION:Club San Fernando',
    `DESCRIPTION:${escIcs(`${con} Reservas: ${APP_URL}`.trim())}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Partido de tenis',
    'TRIGGER:-PT2H',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n')
}

export function linkGoogleCalendar(a: Aviso) {
  const z = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Tenis · Cancha ${a.cancha} (${a.tipo_partido})`,
    dates: `${z(a.inicio)}/${z(a.fin)}`,
    location: 'Club San Fernando',
    details: a.otros?.length ? `Con ${listaNombres(a.otros)}.` : '',
  })
  return `https://calendar.google.com/calendar/render?${p}`
}

function marco(titulo: string, cuerpo: string) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(titulo)}</title></head>
<body style="margin:0;padding:0;background:#f6f7f4;font-family:Arial,Helvetica,sans-serif;color:#14211a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f4;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #d5dbd6">
<tr><td style="padding:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="height:5px;background:#09582D"></td><td style="height:5px;background:#ffffff"></td><td style="height:5px;background:#18305B"></td></tr></table></td></tr>
<tr><td style="padding:20px 24px 4px">
<div style="font-size:11px;font-weight:bold;letter-spacing:2px;color:#09582D">CLUB SAN FERNANDO</div>
<div style="font-size:20px;font-weight:bold;margin-top:2px">Reservas de Tenis</div></td></tr>
<tr><td style="padding:12px 24px 24px">${cuerpo}</td></tr>
<tr><td style="padding:16px 24px;background:#f6f7f4;font-size:12px;line-height:1.5;color:#5b6660">
Aviso automático del sistema de reservas de tenis.<br>Club San Fernando · Un club, una familia</td></tr>
</table></td></tr></table></body></html>`
}

function tablaDatos(a: Aviso, tachado = false) {
  const filas: [string, string][] = [
    ['Día', diaLargo(a.fecha)],
    ['Horario', `${sinCero(a.hora_inicio)} a ${sinCero(a.hora_fin)}`],
    ['Cancha', `Cancha ${a.cancha}`],
    ['Partido', a.tipo_partido === 'single' ? 'Single' : 'Dobles'],
  ]
  if (a.otros?.length) filas.push(['Con', listaNombres(a.otros)])
  const estilo = tachado ? 'text-decoration:line-through;color:#5b6660' : ''
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #d5dbd6;border-radius:12px;margin:16px 0">
${filas.map(([k, v], i) => `<tr><td style="padding:10px 14px;color:#5b6660;font-size:15px;${i ? 'border-top:1px solid #eceeea;' : ''}">${k}</td>
<td style="padding:10px 14px;font-weight:bold;font-size:15px;text-align:right;${i ? 'border-top:1px solid #eceeea;' : ''}${estilo}">${esc(v)}</td></tr>`).join('\n')}
</table>`
}

const boton = (href: string, texto: string, principal = true) =>
  `<a href="${esc(href)}" style="display:inline-block;padding:12px 18px;margin:4px 6px 4px 0;border-radius:10px;font-weight:bold;font-size:15px;text-decoration:none;${
    principal ? 'background:#09582D;color:#ffffff' : 'background:#ffffff;color:#09582D;border:1.5px solid #09582D'
  }">${esc(texto)}</a>`

export function armarMail(a: Aviso) {
  const cuando = `${diaLargo(a.fecha)}, ${sinCero(a.hora_inicio)}`
  if (a.tipo === 'confirmada') {
    const intro = a.detalle
      ? a.detalle
      : a.es_titular
        ? 'Tu reserva quedó confirmada.'
        : `${a.titular} te sumó a un partido.`
    const pie = a.es_titular
      ? 'Si no pueden ir, cancelala desde “Mis reservas” así otro socio aprovecha la cancha.'
      : `Si no podés ir, avisale a ${a.titular} para que la cancele.`
    const asunto = `Reserva confirmada · Cancha ${a.cancha} · ${cuando}`
    const html = marco(asunto, `
<h1 style="margin:0 0 8px;font-size:24px">¡Tenés cancha!</h1>
<p style="margin:0 0 4px;font-size:16px;line-height:1.5">Hola ${esc(a.nombre)},</p>
<p style="margin:0;font-size:16px;line-height:1.5">${esc(intro)}</p>
${tablaDatos(a)}
<div>${boton(linkGoogleCalendar(a), 'Agregar a Google Calendar')}${boton(`${APP_URL}/`, 'Ver mis reservas', false)}</div>
<p style="margin:16px 0 0;font-size:13px;color:#5b6660;line-height:1.5">También va adjunto el evento para Apple Calendar u Outlook, con un recordatorio 2 horas antes.</p>
<p style="margin:12px 0 0;font-size:14px;line-height:1.5">${esc(pie)} La luz, si hace falta, se abona con ficha en la cancha.</p>`)
    const texto = [
      `Hola ${a.nombre},`, '', intro, '',
      `Día: ${diaLargo(a.fecha)}`,
      `Horario: ${sinCero(a.hora_inicio)} a ${sinCero(a.hora_fin)}`,
      `Cancha: ${a.cancha} (${a.tipo_partido})`,
      a.otros?.length ? `Con: ${listaNombres(a.otros)}` : '',
      '', pie, '', `Reservas: ${APP_URL}`,
    ].filter((l, i, arr) => l !== '' || arr[i - 1] !== '').join('\n')
    return {
      asunto, html, texto,
      adjuntos: [{ filename: 'partido-tenis.ics', content: ics(a), contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }],
    }
  }

  if (a.tipo === 'modificada') {
    const asunto = `Cambio en tu reserva · Cancha ${a.cancha} · ${cuando}`
    const intro = a.detalle ?? 'La Capitanía de Tenis modificó tu reserva.'
    const html = marco(asunto, `
<h1 style="margin:0 0 8px;font-size:24px">Cambió tu partido</h1>
<p style="margin:0 0 4px;font-size:16px;line-height:1.5">Hola ${esc(a.nombre)},</p>
<p style="margin:0;font-size:16px;line-height:1.5">${esc(intro)}</p>
${tablaDatos(a)}
<div>${boton(linkGoogleCalendar(a), 'Actualizar en Google Calendar')}${boton(`${APP_URL}/`, 'Ver mis reservas', false)}</div>
<p style="margin:16px 0 0;font-size:13px;color:#5b6660;line-height:1.5">Va adjunto el evento actualizado para Apple Calendar u Outlook.</p>`)
    const texto = [
      `Hola ${a.nombre},`, '', intro, '',
      `Día: ${diaLargo(a.fecha)}`,
      `Horario: ${sinCero(a.hora_inicio)} a ${sinCero(a.hora_fin)}`,
      `Cancha: ${a.cancha} (${a.tipo_partido})`,
      a.otros?.length ? `Con: ${listaNombres(a.otros)}` : '',
      '', `Reservas: ${APP_URL}`,
    ].filter((l, i, arr) => l !== '' || arr[i - 1] !== '').join('\n')
    return {
      asunto, html, texto,
      adjuntos: [{ filename: 'partido-tenis.ics', content: ics(a), contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }],
    }
  }

  if (a.tipo === 'quitado') {
    const asunto = `Ya no figurás en este partido · Cancha ${a.cancha} · ${cuando}`
    const intro = a.detalle ?? 'La Capitanía de Tenis te sacó de este partido.'
    const html = marco(asunto, `
<h1 style="margin:0 0 8px;font-size:24px">Ya no figurás en este partido</h1>
<p style="margin:0 0 4px;font-size:16px;line-height:1.5">Hola ${esc(a.nombre)},</p>
<p style="margin:0;font-size:16px;line-height:1.5">${esc(intro)}</p>
${tablaDatos({ ...a, otros: null }, true)}
<p style="margin:0 0 12px;font-size:15px;line-height:1.5">Si es un error, consultá en la Capitanía de Tenis.</p>
<div>${boton(`${APP_URL}/`, 'Ver mis reservas')}</div>
<p style="margin:16px 0 0;font-size:13px;color:#5b6660;line-height:1.5">Si lo habías agendado, acordate de borrarlo de tu calendario.</p>`)
    const texto = [
      `Hola ${a.nombre},`, '', intro, '',
      `Día: ${diaLargo(a.fecha)}`,
      `Horario: ${sinCero(a.hora_inicio)} a ${sinCero(a.hora_fin)}`,
      `Cancha: ${a.cancha}`, '',
      'Si es un error, consultá en la Capitanía de Tenis.',
    ].join('\n')
    return { asunto, html, texto, adjuntos: [] as { filename: string; content: string; contentType: string }[] }
  }

  const porque = a.yo_cancele
    ? `Cancelaste tu reserva.${a.otros?.length ? ` ${a.otros.length === 1 ? 'Le' : 'Les'} avisamos a ${listaNombres(a.otros)}.` : ''}`
    : motivoCancelacion(a)
  const asunto = `Reserva cancelada · Cancha ${a.cancha} · ${cuando}`
  const html = marco(asunto, `
<h1 style="margin:0 0 8px;font-size:24px">${a.yo_cancele ? 'Cancelaste tu reserva' : 'Se canceló tu partido'}</h1>
<p style="margin:0 0 4px;font-size:16px;line-height:1.5">Hola ${esc(a.nombre)},</p>
<p style="margin:0;font-size:16px;line-height:1.5">${esc(porque)}</p>
${tablaDatos(a, true)}
<p style="margin:0 0 12px;font-size:15px;line-height:1.5">Ya podés reservar otro horario.</p>
<div>${boton(`${APP_URL}/`, 'Reservar otra cancha')}</div>
<p style="margin:16px 0 0;font-size:13px;color:#5b6660;line-height:1.5">Si lo habías agendado, acordate de borrarlo de tu calendario.</p>`)
  const texto = [
    `Hola ${a.nombre},`, '', porque, '',
    `Día: ${diaLargo(a.fecha)}`,
    `Horario: ${sinCero(a.hora_inicio)} a ${sinCero(a.hora_fin)}`,
    `Cancha: ${a.cancha}`, '',
    `Podés reservar otro horario: ${APP_URL}`,
  ].join('\n')
  return { asunto, html, texto, adjuntos: [] as { filename: string; content: string; contentType: string }[] }
}

// ---------------------------------------------------------------------
// Envío
// ---------------------------------------------------------------------
// Clave interna de Supabase: la nueva (SUPABASE_SECRET_KEYS) o, si no está, la legacy
function claveInterna() {
  try {
    const nuevas = JSON.parse(env('SUPABASE_SECRET_KEYS', '{}'))
    if (nuevas.default) return nuevas.default as string
    const primera = Object.values(nuevas)[0]
    if (typeof primera === 'string') return primera
  } catch { /* sin claves nuevas */ }
  return env('SUPABASE_SERVICE_ROLE_KEY')
}

async function procesar() {
  const sb = createClient(env('SUPABASE_URL'), claveInterna(), { auth: { persistSession: false } })
  const transporte = nodemailer.createTransport({
    host: env('SMTP_HOST', 'mail.clubsanfernando.org.ar'),
    port: 465,
    secure: true,
    auth: { user: REMITENTE, pass: env('SMTP_PASS') },
  })

  const resumen = { enviados: 0, descartados: 0, fallidos: 0, errores: [] as string[] }
  for (let vuelta = 0; vuelta < 3; vuelta++) { // hasta 60 avisos por llamada
    const { data, error } = await sb.rpc('avisos_tomar', { p_limite: 20 })
    if (error) throw new Error(`avisos_tomar: ${error.message}`)
    const avisos = (data ?? []) as Aviso[]
    if (avisos.length === 0) break

    for (const a of avisos) {
      // Una confirmación de una reserva que ya se canceló no se manda
      if ((a.tipo === 'confirmada' || a.tipo === 'modificada') && a.estado_reserva !== 'activa') {
        await sb.rpc('avisos_resultado', { p_id: a.id, p_resultado: 'descartado' })
        resumen.descartados++
        continue
      }
      try {
        const m = armarMail(a)
        await transporte.sendMail({
          from: { name: 'Reservas de Tenis · Club San Fernando', address: REMITENTE },
          to: a.email,
          subject: m.asunto,
          text: m.texto,
          html: m.html,
          attachments: m.adjuntos,
        })
        await sb.rpc('avisos_resultado', { p_id: a.id, p_resultado: 'enviado' })
        resumen.enviados++
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        await sb.rpc('avisos_resultado', { p_id: a.id, p_resultado: 'fallo', p_error: msg })
        resumen.fallidos++
        resumen.errores.push(`#${a.id}: ${msg}`)
      }
    }
  }
  transporte.close()
  return resumen
}

// Deno.serve solo cuando corre en Supabase (en las pruebas se importan las plantillas)
if (!Deno.env.get('AVISOS_PRUEBA')) {
  Deno.serve(async (req) => {
    const clave = env('AVISOS_CLAVE')
    if (!clave || req.headers.get('x-avisos-clave') !== clave) {
      return new Response(JSON.stringify({ error: 'no autorizado' }), { status: 401 })
    }
    if (!env('SMTP_PASS')) {
      return new Response(JSON.stringify({ error: 'falta SMTP_PASS' }), { status: 500 })
    }
    try {
      const r = await procesar()
      return new Response(JSON.stringify(r), { headers: { 'Content-Type': 'application/json' } })
    } catch (e) {
      return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500 })
    }
  })
}
