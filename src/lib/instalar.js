// "Agregar a la pantalla de inicio": captura el aviso de instalación del navegador
// (Chrome/Edge en Android) apenas carga la página, para ofrecerlo con un botón propio.
let aviso = null
const oyentes = new Set()
const avisar = () => oyentes.forEach((f) => f())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); aviso = e; avisar() })
  window.addEventListener('appinstalled', () => { aviso = null; avisar() })
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
  }
}

export const yaInstalada = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true

const ua = () => window.navigator.userAgent
export const esIOS = () => /iPhone|iPad|iPod/.test(ua()) || (/Macintosh/.test(ua()) && navigator.maxTouchPoints > 1)
export const esCelular = () => esIOS() || /Android|Mobile/.test(ua())

export const puedeInstalar = () => !!aviso
export function escuchar(f) { oyentes.add(f); return () => oyentes.delete(f) }

export async function instalar() {
  if (!aviso) return false
  aviso.prompt()
  const { outcome } = await aviso.userChoice
  aviso = null
  avisar()
  return outcome === 'accepted'
}
