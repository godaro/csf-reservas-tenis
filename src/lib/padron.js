// Lectura y limpieza del padrón de socios con carnet de tenis (Excel o PDF de AF Sistemas).
// Columnas esperadas (en cualquier orden): Socio · Nombre ("APELLIDO NOMBRE") · Teléfono · Email · Dni
// y, si vienen (PDF), Hasta (MM-AAAA: vencido = fuera) y Cantidad (0 = fuera).

const PART = new Set(['DE', 'DEL', 'DI', 'DA', 'D', 'LA', 'LAS', 'LOS', 'VAN', 'VON', 'DOS', 'MAC', 'MC', 'SAN'])
const MINUS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'van', 'von', 'da', 'di', 'dos'])

function titulo(palabras) {
  return palabras.map((w, i) => {
    const lw = w.toLowerCase()
    if (i > 0 && MINUS.has(lw.replace(/\.+$/, ''))) return lw
    if (/^([A-ZÑ]\.)+[A-ZÑ]?\.?$/.test(w.toUpperCase())) return w.toUpperCase() // iniciales: L. / E.A.
    return lw.replace(/(^|[-'´’(])([a-zñáéíóúü])/g, (_, a, b) => a + b.toUpperCase())
  }).join(' ')
}

// "DE LA FUENTE JUAN" → { apellido: "de la Fuente"… } según la regla del padrón: apellido = 1ª palabra + partículas
export function partirNombre(txt) {
  const t = String(txt ?? '').replace(/,/g, ' ').trim().replace(/[.-]+$/, '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean)
  let i = 1
  while (i < t.length && PART.has(t[i - 1].toUpperCase())) i++
  const ape = t.slice(0, i)
  const nom = t.slice(i)
  return { nombre: nom.length ? titulo(nom) : '', apellido: titulo(ape) }
}

export const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/

const DOMINIOS = [
  [/@g(m(a(i(l(\.c?o?m?)?)?)?)?)?$/, '@gmail.com'],
  [/@gamil(\.c?o?m?)?$/, '@gmail.com'],
  [/@yahoo\.com\.a?$/, '@yahoo.com.ar'],
  [/@fibertel(\.(c(o(m(\.a?)?)?)?)?)?$/, '@fibertel.com.ar'],
  [/@sinectis(\.(c(o(m(\.a?)?)?)?)?)?$/, '@sinectis.com.ar'],
  [/@transportesruta\.com\.$/, '@transportesruta.com.ar'],
]

// Devuelve { email, estado }: estado 'ok' | 'completado' | 'sin_mail' | 'generico' | 'cortado'
export function limpiarMail(v) {
  const e = String(v ?? '').trim().toLowerCase()
  if (!e) return { email: null, estado: 'sin_mail' }
  if (/-\.-|noposee|^contaduria@|clubsanfe/.test(e)) return { email: null, estado: 'generico' }
  if (EMAIL.test(e)) return { email: e, estado: 'ok' }
  for (const [re, dom] of DOMINIOS) {
    if (re.test(e)) {
      const c = e.replace(re, dom)
      if (EMAIL.test(c)) return { email: c, estado: 'completado' }
    }
  }
  return { email: e, estado: 'cortado' } // se carga incompleto: la base no le manda avisos
}

const COLUMNAS = {
  nro: /^(n[°ºro.]*\s*(de\s*)?)?socio$|^nro\.?$|^n[°º]$/,
  nombre: /^(apellido\s*y\s*)?nombre/,
  celular: /^tel|^cel/,
  email: /^e-?mail|^correo/,
  dni: /^dni|^documento|^doc|^nrodoc/,
  hasta: /^hasta$/,
  cantidad: /^cantidad$/,
}

// "MM-AAAA" → número comparable (202610); null si no es una fecha así
const mesAnio = (v) => {
  const m = /^(\d{1,2})-(\d{4})$/.exec(String(v ?? '').trim())
  return m ? Number(m[2]) * 100 + Number(m[1]) : null
}
const mesActual = () => {
  const [y, m] = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).split('-')
  return Number(y) * 100 + Number(m)
}
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

// rows: matriz del Excel (primera fila = encabezados). Devuelve { filas, errores }
export function leerPadron(rows) {
  const iEnc = rows.findIndex((r) => r.some((c) => COLUMNAS.nro.test(norm(c))) && r.some((c) => COLUMNAS.dni.test(norm(c))))
  if (iEnc < 0) {
    return { filas: [], excluidos: [], errores: ['No encontramos los encabezados "Socio" y "Dni" en el archivo.'] }
  }
  const enc = rows[iEnc].map(norm)
  const col = {}
  for (const [k, re] of Object.entries(COLUMNAS)) col[k] = enc.findIndex((c) => re.test(c))
  const faltan = Object.entries(col).filter(([k, i]) => i < 0 && ['nro', 'nombre', 'dni'].includes(k)).map(([k]) => k)
  if (faltan.length) return { filas: [], excluidos: [], errores: [`Faltan columnas: ${faltan.join(', ')}.`] }

  // Un socio puede venir más de una vez (por ejemplo, un período viejo vencido y uno nuevo):
  // cuenta como vigente si alguno de sus renglones lo está.
  const hoy = mesActual()
  const porNro = new Map()
  for (const r of rows.slice(iEnc + 1)) {
    const celda = (k) => (col[k] >= 0 ? r[col[k]] : null)
    const crudo = celda('nro')
    if (crudo == null || crudo === '') continue
    const nro = typeof crudo === 'number' ? String(Math.trunc(crudo)) : String(crudo).replace(/\D/g, '')
    if (!nro) continue
    const hasta = mesAnio(celda('hasta'))
    const cantidad = col.cantidad >= 0 ? String(celda('cantidad') ?? '').trim() : null
    let motivo = null
    if (col.hasta >= 0 && hasta !== null && hasta < hoy) motivo = `Carnet vencido (hasta ${String(celda('hasta')).trim()})`
    else if (cantidad !== null && /^0+([.,]0+)?$/.test(cantidad)) motivo = 'Cantidad 0 en AF Sistemas'
    const previo = porNro.get(nro)
    if (previo && !previo.motivo) continue // ya tiene un renglón vigente
    if (previo && motivo) continue // los dos fuera: queda el primero
    porNro.set(nro, { r, celda, motivo })
  }

  const filas = []
  const excluidos = []
  for (const [nro, { celda, motivo }] of porNro) {
    const { nombre, apellido } = partirNombre(celda('nombre'))
    if (motivo) { excluidos.push({ nro, nombre: `${nombre} ${apellido}`.trim(), apellido, motivo }); continue }
    const { email, estado } = limpiarMail(celda('email'))
    const tel = String(celda('celular') ?? '').trim().replace(/\s+/g, ' ').replace(/^[\s/-]+|[\s/-]+$/g, '') || null
    const dniCrudo = celda('dni')
    const dni = String(typeof dniCrudo === 'number' ? Math.trunc(dniCrudo) : dniCrudo ?? '').replace(/\D/g, '')
    filas.push({ nro, dni, nombre, apellido, email, celular: tel, estado_mail: estado })
  }
  excluidos.sort((a, b) => a.apellido.localeCompare(b.apellido, 'es'))
  return { filas, excluidos, errores: filas.length ? [] : ['El archivo no trae socios con carnet vigente.'] }
}
