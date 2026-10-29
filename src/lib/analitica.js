// Google Analytics 4 (solo si está configurado VITE_GA_ID en Netlify).
// Nunca se manda información personal: ni número de socio, ni nombres, ni DNI.
// La app no cambia de dirección entre pantallas, así que cada pantalla se registra
// como una "página" virtual (/reservar, /mis-reservas, /capitania, …).
const ID = import.meta.env.VITE_GA_ID

let iniciado = false
function iniciar() {
  if (iniciado || !ID || typeof window === 'undefined') return
  iniciado = true
  window.dataLayer = window.dataLayer || []
  window.gtag = function () { window.dataLayer.push(arguments) } // eslint-disable-line prefer-rest-params
  window.gtag('js', new Date())
  window.gtag('config', ID, { send_page_view: false })
  const s = document.createElement('script')
  s.async = true
  s.src = `https://www.googletagmanager.com/gtag/js?id=${ID}`
  document.head.appendChild(s)
}

let ultima = null
export function vista(ruta, titulo) {
  if (!ID) return
  iniciar()
  if (ruta === ultima) return
  ultima = ruta
  window.gtag('event', 'page_view', {
    page_path: ruta,
    page_location: `${window.location.origin}${ruta}`,
    page_title: titulo ? `${titulo} · Reservas de Tenis` : 'Reservas de Tenis',
  })
}

export function evento(nombre, datos = {}) {
  if (!ID) return
  iniciar()
  window.gtag('event', nombre, datos)
}
