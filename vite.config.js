import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// Dirección pública (para las vistas previas al compartir un link)
const SITIO = 'https://reservas-tenis.netlify.app'

// La app es una sola página, pero WhatsApp, Facebook, etc. leen el HTML sin ejecutar la app.
// Por eso se genera una copia del index.html por ruta, con su título y descripción.
const RUTAS = {
  capitania: {
    titulo: 'Panel de Capitanía · Reservas de Tenis',
    descripcion: 'Acceso exclusivo para la Capitanía de Tenis del Club San Fernando: grilla de canchas, bloqueos y reservas.',
  },
  admin: {
    titulo: 'Administración · Reservas de Tenis',
    descripcion: 'Padrón de socios con carnet de tenis del Club San Fernando. Acceso exclusivo para Administración.',
  },
  mantenimiento: {
    titulo: 'Canchas de tenis · Mantenimiento',
    descripcion: 'Ocupación de las canchas de tenis del Club San Fernando en el día: libres, en uso, bloqueadas y en mantenimiento.',
  },
}

function paginasPorRuta() {
  let dir = 'dist'
  return {
    name: 'paginas-por-ruta',
    apply: 'build',
    configResolved(c) { dir = c.build.outDir },
    closeBundle() {
      const base = fs.readFileSync(path.join(dir, 'index.html'), 'utf8')
      for (const [ruta, { titulo, descripcion }] of Object.entries(RUTAS)) {
        const html = base
          .replace(/<title>[^<]*<\/title>/, `<title>${titulo}</title>`)
          .replace(/(<meta name="description" content=")[^"]*/, `$1${descripcion}`)
          .replace(/(<meta property="og:title" content=")[^"]*/, `$1${titulo}`)
          .replace(/(<meta property="og:description" content=")[^"]*/, `$1${descripcion}`)
          .replace(/(<meta property="og:url" content=")[^"]*/, `$1${SITIO}/${ruta}`)
          // Las páginas internas no aparecen en buscadores
          .replace('</head>', '    <meta name="robots" content="noindex, nofollow" />\n  </head>')
        fs.mkdirSync(path.join(dir, ruta), { recursive: true })
        fs.writeFileSync(path.join(dir, ruta, 'index.html'), html)
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), paginasPorRuta()],
})
