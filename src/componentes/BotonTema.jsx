import { useEffect, useState } from 'react'

// Elegir el tema: automático (según el dispositivo) → oscuro → claro
const ORDEN = ['auto', 'oscuro', 'claro']
const TEXTO = { auto: 'Tema automático (según tu dispositivo)', oscuro: 'Tema oscuro', claro: 'Tema claro' }
const oscuroDelSistema = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches

function leer() {
  try {
    const t = localStorage.getItem('csf-tema')
    return t === 'claro' || t === 'oscuro' ? t : 'auto'
  } catch { return 'auto' }
}

function aplicar(tema) {
  const raiz = document.documentElement
  if (tema === 'auto') delete raiz.dataset.tema
  else raiz.dataset.tema = tema
  try {
    if (tema === 'auto') localStorage.removeItem('csf-tema')
    else localStorage.setItem('csf-tema', tema)
  } catch { /* modo privado: dura lo que dure la pestaña */ }
  // Color de la barra del navegador en el celular
  const oscuro = tema === 'oscuro' || (tema === 'auto' && oscuroDelSistema())
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    m.setAttribute('content', oscuro ? '#18221d' : '#09582D')
    m.removeAttribute('media')
  }
}

export default function BotonTema() {
  const [tema, setTema] = useState(leer)
  useEffect(() => { aplicar(tema) }, [tema])
  const siguiente = ORDEN[(ORDEN.indexOf(tema) + 1) % ORDEN.length]

  return (
    <button type="button" onClick={() => setTema(siguiente)}
      aria-label={`${TEXTO[tema]}. Tocá para cambiar a ${TEXTO[siguiente].toLowerCase()}.`} title={TEXTO[tema]}
      className="flex size-10 shrink-0 items-center justify-center rounded-xl text-gris hover:bg-apagado hover:text-tinta">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {tema === 'claro' && (<><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" /></>)}
        {tema === 'oscuro' && <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />}
        {tema === 'auto' && (<><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" stroke="none" /></>)}
      </svg>
    </button>
  )
}
