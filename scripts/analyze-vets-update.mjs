// Analiza el xlsx vs. el sheet mailing_veterinarios actual.
// Reporta: nuevos netos, existentes con cambios, existentes iguales, dups, sin email.
// READ-ONLY: no modifica nada.
// Uso: node scripts/analyze-vets-update.mjs
import { google } from 'googleapis'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import XLSX from 'xlsx-js-style'

const XLSX_PATH = 'G:/Mi unidad/2. Industrias NC/Veterinarios/Base de datos veterinarios.xlsx'

const env = readFileSync(resolve('.env.local'), 'utf8')
  .split('\n')
  .reduce((acc, line) => {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/)
    if (m) acc[m[1]] = m[2].replace(/^"|"$/g, '')
    return acc
  }, {})

const auth = new google.auth.JWT({
  email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
})
const sheets = google.sheets({ version: 'v4', auth })

function normEmail(s) { return (s ?? '').toString().trim().toLowerCase() }
function clean(s) { return (s ?? '').toString().trim() }
function mapTamano(s) {
  const t = clean(s).toUpperCase()
  if (t === 'A') return 'grande'
  if (t === 'B') return 'mediano'
  if (t === 'C') return 'pequeño'
  if (t === 'GRANDE' || t === 'MEDIANO' || t === 'PEQUEÑO') return clean(s).toLowerCase()
  return ''
}

async function readSheet(name) {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: env.GOOGLE_SPREADSHEET_ID,
    range: name,
    valueRenderOption: 'UNFORMATTED_VALUE',
  })
  const all = r.data.values ?? []
  if (all.length === 0) return { headers: [], rows: [] }
  const headers = all[0]
  const rows = all.slice(1).map(row => {
    const o = {}
    headers.forEach((k, i) => { o[k] = (row[i] ?? '').toString() })
    return o
  })
  return { headers, rows }
}

console.log('Leyendo xlsx...')
const buf = readFileSync(XLSX_PATH)
const wb = XLSX.read(buf, { type: 'buffer' })
const ws = wb.Sheets[wb.SheetNames[0]]
const rawRows = XLSX.utils.sheet_to_json(ws, { defval: '' })

console.log('Leyendo mailing_veterinarios y veterinarios CRM...')
const [mailing, crm] = await Promise.all([
  readSheet('mailing_veterinarios'),
  readSheet('veterinarios'),
])

const mailingByEmail = new Map(mailing.rows.map(r => [normEmail(r.email), r]).filter(([e]) => e))
const crmByEmail = new Map(crm.rows.map(r => [normEmail(r.correo), r]).filter(([e]) => e))

// Construir candidatos del xlsx (uno por email, dedup interno)
const seen = new Set()
const candidatos = []
let skipSinEmail = 0
let dupsInternos = 0
for (const r of rawRows) {
  const email = normEmail(r.Mail)
  if (!email) { skipSinEmail++; continue }
  if (seen.has(email)) { dupsInternos++; continue }
  seen.add(email)
  const veterinaria = clean(r['Clinica Veterinaria'])
  const contacto = clean(r.Contacto)
  candidatos.push({
    email,
    nombre: contacto || veterinaria,
    veterinaria,
    comuna: clean(r.Comuna),
    telefono: clean(r.Telefono),
    tamano_veterinaria: mapTamano(r['Tamaño Clinica']),
    categoria: 'prospecto',  // todos los del xlsx son prospectos
    raw: r,
  })
}

// Categorizar contra el sheet actual
const nuevos = []
const conCambios = []
const sinCambios = []
const enCRM = []

function diffRow(actual, nuevo) {
  // Devuelve los campos que cambian. SOLO consideramos "cambio" cuando el nuevo
  // valor del xlsx NO está vacío y es distinto al actual (no pisamos con vacío).
  const diffs = []
  const campos = ['nombre', 'veterinaria', 'comuna', 'telefono', 'tamano_veterinaria']
  for (const c of campos) {
    const a = clean(actual[c])
    const n = clean(nuevo[c])
    if (n && a !== n) diffs.push({ campo: c, actual: a, nuevo: n })
  }
  return diffs
}

for (const cand of candidatos) {
  if (crmByEmail.has(cand.email)) {
    enCRM.push(cand)
    continue
  }
  const existente = mailingByEmail.get(cand.email)
  if (!existente) {
    nuevos.push(cand)
  } else {
    const diffs = diffRow(existente, cand)
    if (diffs.length === 0) sinCambios.push(cand)
    else conCambios.push({ ...cand, existente, diffs })
  }
}

console.log('')
console.log('═══ Reporte ═══')
console.log(`Filas en xlsx:                       ${rawRows.length}`)
console.log(`  sin email (descartadas):           ${skipSinEmail}`)
console.log(`  duplicadas internas del xlsx:     ${dupsInternos}`)
console.log(`  únicas con email:                  ${candidatos.length}`)
console.log('')
console.log(`En sheet mailing_veterinarios actual: ${mailing.rows.length}`)
console.log(`En sheet veterinarios CRM:            ${crm.rows.length}`)
console.log('')
console.log(`Ya están en CRM (skip):              ${enCRM.length}`)
console.log(`Existen sin cambios:                 ${sinCambios.length}`)
console.log(`Existen con datos distintos:         ${conCambios.length}`)
console.log(`Nuevos netos para agregar:           ${nuevos.length}`)
console.log('')

if (conCambios.length > 0) {
  console.log('Sample de cambios (primeros 5):')
  conCambios.slice(0, 5).forEach((c, i) => {
    console.log(`  [${i + 1}] ${c.veterinaria} <${c.email}>`)
    for (const d of c.diffs) {
      console.log(`        ${d.campo}: "${d.actual}" → "${d.nuevo}"`)
    }
  })
  console.log('')

  // Detalle: qué campos son los que más cambian
  const conteoPorCampo = new Map()
  for (const c of conCambios) {
    for (const d of c.diffs) {
      conteoPorCampo.set(d.campo, (conteoPorCampo.get(d.campo) || 0) + 1)
    }
  }
  console.log('Distribución de cambios por campo:')
  Array.from(conteoPorCampo.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${k}: ${v} filas`))
  console.log('')
}

if (nuevos.length > 0) {
  console.log('Sample de nuevos netos (primeros 5):')
  nuevos.slice(0, 5).forEach((n, i) => {
    console.log(`  [${i + 1}] ${n.veterinaria || '(sin nombre)'} | ${n.email} | ${n.comuna || '—'} | ${n.tamano_veterinaria || '—'}`)
  })
}
