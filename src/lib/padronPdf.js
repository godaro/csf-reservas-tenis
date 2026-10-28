// Lectura del PDF "Listado de Socios por Conceptos" de AF Sistemas (QuickReports).
// Cada socio ocupa dos renglones:
//   1) Concepto · Cantidad · Desde · Hasta · Manzana/Lote · Socio · Nombre
//   2) Dirección · CP · Localidad · Teléfono · E-Mail · Nrodoc · Fecha Nac · Relación
// Las columnas se ubican por la posición horizontal de los encabezados de cada hoja.
// Devuelve una matriz con encabezados, como si fuera un Excel, para usar leerPadron().

const COLS_1 = ['Cantidad', 'Desde', 'Hasta', 'Manzana', 'Lote', 'Socio', 'Nombre']
const COLS_2 = ['Dirección', 'CP', 'Localidad', 'Teléfono', 'E-Mail', 'Nrodoc', 'Fecha Nac', 'Relación']

function agruparRenglones(items) {
  const renglones = []
  for (const it of items) {
    const r = renglones.find((x) => Math.abs(x.y - it.y) < 2.5)
    if (r) r.items.push(it)
    else renglones.push({ y: it.y, items: [it] })
  }
  renglones.sort((a, b) => b.y - a.y) // de arriba hacia abajo
  for (const r of renglones) r.items.sort((a, b) => a.x - b.x)
  return renglones
}

// A qué columna pertenece cada texto: la del encabezado más cercano en horizontal
function asignar(items, columnas) {
  const out = {}
  for (const it of items) {
    let col = null
    let dist = Infinity
    for (const c of columnas) {
      const d = Math.abs(it.x - c.x)
      if (d < dist) { dist = d; col = c.nombre }
    }
    if (!col) continue
    out[col] = out[col] ? `${out[col]} ${it.str}` : it.str
  }
  return out
}

export function filasDesdeTextos(paginas) {
  const filas = [['Socio', 'Nombre', 'Teléfono', 'Email', 'Dni', 'Hasta', 'Cantidad']]
  let enc1 = null
  let enc2 = null
  for (const items of paginas) {
    const renglones = agruparRenglones(items)
    // Encabezados de esta hoja
    for (const r of renglones) {
      const textos = r.items.map((i) => i.str.trim())
      if (textos.includes('Socio') && textos.includes('Nombre')) {
        enc1 = r.items.filter((i) => COLS_1.includes(i.str.trim())).map((i) => ({ nombre: i.str.trim(), x: i.x }))
      }
      if (textos.includes('E-Mail') && textos.includes('Nrodoc')) {
        enc2 = r.items.filter((i) => COLS_2.includes(i.str.trim())).map((i) => ({ nombre: i.str.trim(), x: i.x }))
      }
    }
    if (!enc1 || !enc2) continue
    enc1.sort((a, b) => a.x - b.x)
    enc2.sort((a, b) => a.x - b.x)

    renglones.forEach((r, i) => {
      if (!r.items.some((it) => /CARNET|^\($/.test(it.str.trim())) || !r.items.some((it) => /^\d{2}-\d{4}$/.test(it.str.trim()))) return
      const a = asignar(r.items.filter((it) => it.x > enc1[0].x - 10), enc1)
      // Segundo renglón: el siguiente hacia abajo, a menos de ~18 puntos
      const sig = renglones.slice(i + 1).find((x) => r.y - x.y > 4 && r.y - x.y < 18)
      const b = sig ? asignar(sig.items, enc2) : {}
      const nro = String(a.Socio ?? '').replace(/\D/g, '')
      if (!nro) return
      filas.push([nro, (a.Nombre ?? '').trim(), (b['Teléfono'] ?? '').trim(), (b['E-Mail'] ?? '').trim(),
        String(b.Nrodoc ?? '').replace(/\D/g, ''), (a.Hasta ?? '').trim(), (a.Cantidad ?? '').trim()])
    })
  }
  return filas
}

// Navegador: lee el archivo con pdf.js (se carga solo cuando hace falta)
export async function leerPdf(file) {
  const pdfjs = await import('pdfjs-dist')
  const { default: worker } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const paginas = []
  for (let n = 1; n <= doc.numPages; n++) {
    const tc = await (await doc.getPage(n)).getTextContent()
    paginas.push(tc.items.filter((i) => i.str && i.str.trim()).map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5] })))
  }
  return filasDesdeTextos(paginas)
}
