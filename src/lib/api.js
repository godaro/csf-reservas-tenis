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
    e.code = error.code || null
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
  // Con el horario del partido, avisa qué compañeros ya no pueden (máximo de reservas o muy cerca).
  // Si la base todavía no tiene la versión nueva, se usa la anterior (sin horario).
  buscarSocios: (token, q, inicio, fin) =>
    rpc('buscar_socios', { p_token: token, p_q: q, p_inicio: inicio, p_fin: fin })
      .catch((e) => (e.code === 'PGRST202' ? rpc('buscar_socios', { p_token: token, p_q: q }) : Promise.reject(e))),
  frecuentes: (token, inicio, fin) =>
    rpc('companeros_frecuentes', { p_token: token, p_inicio: inicio, p_fin: fin })
      .catch((e) => (e.code === 'PGRST202' ? rpc('companeros_frecuentes', { p_token: token }) : Promise.reject(e))),
  reservar: (token, cancha, inicio, tipo, jugadores) =>
    rpc('reservar', {
      p_token: token,
      p_cancha: cancha,
      p_inicio: inicio,
      p_tipo: tipo,
      p_jugadores: jugadores,
    }),
  misReservas: (token) => rpc('mis_reservas', { p_token: token }),
  miPerfil: (token) => rpc('mi_perfil', { p_token: token }),
  actualizarMiEmail: (token, email) => rpc('actualizar_mi_email', { p_token: token, p_email: email }),
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
  capitaniaReserva: (token, id) => rpc('capitania_reserva', { p_token: token, p_id: id }),
  capitaniaMover: (token, id, cancha, motivo) =>
    rpc('capitania_mover_cancha', { p_token: token, p_id: id, p_cancha: cancha, p_motivo: motivo || null }),
  capitaniaReemplazar: (token, id, sale, entra, motivo) =>
    rpc('capitania_reemplazar_jugador', { p_token: token, p_id: id, p_sale: sale, p_entra: entra, p_motivo: motivo || null }),
  // Administración (/admin)
  adminResumen: (token) => rpc('admin_resumen', { p_token: token }),
  adminPrevisualizar: (token, filas) => rpc('admin_previsualizar_padron', { p_token: token, p_filas: filas }),
  adminAplicar: (token, filas, mantener, archivo) =>
    rpc('admin_aplicar_padron', { p_token: token, p_filas: filas, p_mantener: mantener, p_archivo: archivo }),
  adminBuscar: (token, q) => rpc('admin_buscar_socios', { p_token: token, p_q: q }),
  adminAlta: (token, s) =>
    rpc('admin_alta_manual', {
      p_token: token, p_nro: s.nro, p_dni: s.dni, p_nombre: s.nombre, p_apellido: s.apellido,
      p_email: s.email || null, p_celular: s.celular || null,
    }),
  adminMailsCorregidos: (token) => rpc('admin_mails_corregidos', { p_token: token }),
  adminBaja: (token, nro) => rpc('admin_baja_carnet', { p_token: token, p_nro: nro }),
  adminReactivar: (token, nro) => rpc('admin_reactivar_carnet', { p_token: token, p_nro: nro }),
}

// ¿Dónde estamos? App de socios (/), panel de Capitanía (/capitania) o Administración (/admin)
const RUTA = window.location.pathname.replace(/\/+$/, '')
export const ES_PANEL = RUTA === '/capitania'
export const ES_ADMIN = RUTA === '/admin'
// Rol que corresponde a esta dirección
export const ROL_RUTA = ES_ADMIN ? 'admin' : ES_PANEL ? 'capitania' : 'socio'

// Sesión guardada en el dispositivo (separada para socio, Capitanía y Administración)
const CLAVE = ES_ADMIN ? 'csf-tenis-sesion-admin' : ES_PANEL ? 'csf-tenis-sesion-capitania' : 'csf-tenis-sesion'

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
