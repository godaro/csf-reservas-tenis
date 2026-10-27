import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const configurado = Boolean(url && key)

const supabase = configurado
  ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  : null

// Toda la app habla con la base a través de estas funciones (RPC).
// Los errores de la base ya vienen con un mensaje en castellano para mostrar.
async function rpc(fn, params) {
  const { data, error } = await supabase.rpc(fn, params)
  if (error) {
    const e = new Error(error.message || 'Algo salió mal. Probá de nuevo.')
    e.codigo = error.hint || null // 'SESION', 'OCUPADA'
    throw e
  }
  return data
}

export const api = {
  login: (nro, dni) => rpc('login', { p_nro: nro, p_dni: dni }),
  loginCapitania: (usuario, clave) => rpc('login_capitania', { p_usuario: usuario, p_clave: clave }),
  cambiarClave: (token, actual, nueva) => rpc('cambiar_clave', { p_token: token, p_actual: actual, p_nueva: nueva }),
  logout: (token) => rpc('logout', { p_token: token }),
  dias: (token) => rpc('dias', { p_token: token }),
  disponibilidad: (token, fecha, tipo) =>
    rpc('disponibilidad', { p_token: token, p_fecha: fecha, p_tipo: tipo }),
  buscarSocios: (token, q) => rpc('buscar_socios', { p_token: token, p_q: q }),
  frecuentes: (token) => rpc('companeros_frecuentes', { p_token: token }),
  reservar: (token, cancha, inicio, tipo, jugadores) =>
    rpc('reservar', {
      p_token: token,
      p_cancha: cancha,
      p_inicio: inicio,
      p_tipo: tipo,
      p_jugadores: jugadores,
    }),
  misReservas: (token) => rpc('mis_reservas', { p_token: token }),
  cancelar: (token, id) => rpc('cancelar_reserva', { p_token: token, p_id: id }),
  panelDia: (token, fecha) => rpc('panel_dia', { p_token: token, p_fecha: fecha }),
  previsualizarBloqueo: (token, b) =>
    rpc('previsualizar_bloqueo', {
      p_token: token,
      p_canchas: b.canchas,
      p_fecha: b.fecha,
      p_desde: b.desde,
      p_hasta: b.hasta,
      p_semanal: b.semanal,
    }),
  crearBloqueo: (token, b, cancelarReservas = false) =>
    rpc('crear_bloqueo', {
      p_token: token,
      p_canchas: b.canchas,
      p_fecha: b.fecha,
      p_desde: b.desde,
      p_hasta: b.hasta,
      p_motivo: b.motivo,
      p_semanal: b.semanal,
      p_cancelar_reservas: cancelarReservas,
    }),
  borrarBloqueo: (token, id) => rpc('borrar_bloqueo', { p_token: token, p_id: id }),
}

// ¿Estamos en el panel de Capitanía (/capitania) o en la app de socios (/)?
export const ES_PANEL = window.location.pathname.replace(/\/+$/, '') === '/capitania'

// Sesión guardada en el dispositivo (separada para socio y para Capitanía)
const CLAVE = ES_PANEL ? 'csf-tenis-sesion-capitania' : 'csf-tenis-sesion'

export function leerSesion() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE)) || null
  } catch {
    return null
  }
}

export function guardarSesion(s) {
  try {
    if (s) localStorage.setItem(CLAVE, JSON.stringify(s))
    else localStorage.removeItem(CLAVE)
  } catch {
    /* modo privado: la sesión dura lo que dure la pestaña */
  }
}
