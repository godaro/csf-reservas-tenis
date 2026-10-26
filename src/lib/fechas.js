// Fechas siempre en hora del Club (Argentina, UTC-3 todo el año)
const ZONA = 'America/Argentina/Buenos_Aires'

// 'YYYY-MM-DD' → Date a mediodía local (evita saltos de día por zona horaria)
function deFecha(fecha) {
  const [y, m, d] = fecha.split('-').map(Number)
  return new Date(y, m - 1, d, 12)
}

const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1)

// "Mar 27/10"
export function fechaCorta(fecha) {
  const d = deFecha(fecha)
  const dia = d.toLocaleDateString('es-AR', { weekday: 'short' }).replace('.', '')
  return `${cap(dia)} ${d.getDate()}/${d.getMonth() + 1}`
}

// "martes 27/10"
export function fechaLarga(fecha) {
  const d = deFecha(fecha)
  return `${d.toLocaleDateString('es-AR', { weekday: 'long' })} ${d.getDate()}/${d.getMonth() + 1}`
}

// Etiqueta de las solapas de día: Hoy / Mañana / Jueves
export function etiquetaDia(fecha, indice) {
  if (indice === 0) return 'Hoy'
  if (indice === 1) return 'Mañana'
  return cap(deFecha(fecha).toLocaleDateString('es-AR', { weekday: 'long' }))
}

// Instante ISO → "lunes 26/10 a las 22:00" en hora del Club
export function momento(iso) {
  const d = new Date(iso)
  const dia = d.toLocaleDateString('es-AR', { weekday: 'long', timeZone: ZONA })
  const fecha = d.toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric', timeZone: ZONA })
  const hora = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA })
  return `${dia} ${fecha} a las ${hora}`
}

// Instante ISO → "HH:MM" en hora del Club
export function hora(iso) {
  return new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: ZONA,
  })
}

// Fecha de hoy en el Club, 'YYYY-MM-DD'
export function hoy() {
  return new Date().toLocaleDateString('en-CA', { timeZone: ZONA })
}

// Sumar (o restar) días a una fecha 'YYYY-MM-DD'
export function sumarDias(fecha, n) {
  const d = deFecha(fecha)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const MINUTOS = { single: 60, dobles: 90 }
export const JUGADORES_EXTRA = { single: 1, dobles: 3 }
