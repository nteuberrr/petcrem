// Importa los nuevos veterinarios del xlsx local a la hoja `mailing_veterinarios`.
// - Skip de los que ya están (match por email lowercase/trim).
// - Si no hay 'Contacto' en el xlsx, usa el nombre de la clínica como nombre del destinatario.
// - 'notas' concatena Cargo, Direccion, Fuente, RUT, Codigo Vet, Horario.
// - Append en una sola llamada batch para respetar la cuota de Sheets.
//
// Uso: node scripts/import-vets-to-mailing.mjs [--dry-run]
import { google } from 'googleapis'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import XLSX from 'xlsx-js-style'

const XLSX_PATH = 'G:/Mi unidad/2. Industrias NC/Veterinarios/Base de datos veterinarios.xlsx'
const DRY_RUN = process.argv.includes('--dry-run')

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
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
})
const sheets = google.sheets({ version: 'v4', auth })

function normEmail(s) { return (s ?? '').toString().trim().toLowerCase() }
function clean(s) { return (s ?? '').toString().trim() }
function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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

console.log('Leyendo xlsx local...')
const buf = readFileSync(XLSX_PATH)
const wb = XLSX.read(buf, { type: 'buffer' })
const ws = wb.Sheets[wb.SheetNames[0]]
const rawRows = XLSX.utils.sheet_to_json(ws, { defval: '' })

console.log('Leyendo mailing_veterinarios y veterinarios...')
const [mailing, vets] = await Promise.all([
  readSheet('mailing_veterinarios'),
  readSheet('veterinarios'),
])

const HEADERS = mailing.headers
console.log('Headers de mailing_veterinarios:', HEADERS)

const existentesEnMailing = new Set(mailing.rows.map(r => normEmail(r.email)).filter(Boolean))
const existentesEnVets = new Set(vets.rows.map(r => normEmail(r.correo)).filter(Boolean))

// Dedup interno por email + skip de existentes
const seen = new Set()
const aImportar = []
let skipDups = 0, skipExistentes = 0, skipSinEmail = 0
for (const r of rawRows) {
  const email = normEmail(r.Mail)
  if (!email) { skipSinEmail++; continue }
  if (seen.has(email)) { skipDups++; continue }
  seen.add(email)
  if (existentesEnMailing.has(email)) { skipExistentes++; continue }
  if (existentesEnVets.has(email)) { skipExistentes++; continue }
  aImportar.push(r)
}

// Calcular próximo id
const idsActuales = mailing.rows.map(r => parseInt(r.id, 10)).filter(n => Number.isFinite(n))
const maxId = idsActuales.length > 0 ? Math.max(...idsActuales) : 0
const fecha = todayISO()

const filasOrdenadas = aImportar.map((r, i) => {
  const veterinaria = clean(r['Clinica Veterinaria'])
  const contacto = clean(r.Contacto)
  const nombre = contacto || veterinaria  // fallback: nombre de la clínica
  const notasPartes = []
  if (clean(r.Cargo)) notasPartes.push(`Cargo: ${clean(r.Cargo)}`)
  if (clean(r.Direccion)) notasPartes.push(`Dir: ${clean(r.Direccion)}`)
  if (clean(r.RUT)) notasPartes.push(`RUT: ${clean(r.RUT)}`)
  if (clean(r['Codigo Vet'])) notasPartes.push(`Cod: ${clean(r['Codigo Vet'])}`)
  if (clean(r['Horario de atencion'])) notasPartes.push(`Horario: ${clean(r['Horario de atencion'])}`)
  if (clean(r.Fuente)) notasPartes.push(`Fuente: ${clean(r.Fuente)}`)
  const fila = {
    id: String(maxId + i + 1),
    nombre,
    email: normEmail(r.Mail),
    veterinaria,
    comuna: clean(r.Comuna),
    telefono: clean(r.Telefono),
    categoria: clean(r['Tamaño Clinica']),
    suscrito: 'TRUE',
    notas: notasPartes.join(' · '),
    fecha_creacion: fecha,
  }
  // Mapear al orden exacto de HEADERS de la sheet
  return HEADERS.map(h => fila[h] ?? '')
})

console.log('')
console.log('═══ Plan de import ═══')
console.log(`Filas en xlsx:                  ${rawRows.length}`)
console.log(`  sin email (skip):             ${skipSinEmail}`)
console.log(`  dups internos del xlsx:       ${skipDups}`)
console.log(`  ya existentes en sheets:      ${skipExistentes}`)
console.log(`  a importar (nuevos netos):    ${aImportar.length}`)
console.log(`Próximo id base:                ${maxId + 1}`)
console.log('')
console.log('Sample (primeros 3):')
filasOrdenadas.slice(0, 3).forEach((row, i) => {
  const obj = {}
  HEADERS.forEach((h, j) => { obj[h] = row[j] })
  console.log(`  [${i + 1}]`, obj)
})

if (DRY_RUN) {
  console.log('')
  console.log('DRY RUN — no se ejecuta el append. Vuelvé a correr sin --dry-run para insertar.')
  process.exit(0)
}

if (filasOrdenadas.length === 0) {
  console.log('Nada que importar.')
  process.exit(0)
}

console.log('')
console.log(`Appendeando ${filasOrdenadas.length} filas en batch...`)
const res = await sheets.spreadsheets.values.append({
  spreadsheetId: env.GOOGLE_SPREADSHEET_ID,
  range: 'mailing_veterinarios',
  valueInputOption: 'USER_ENTERED',
  insertDataOption: 'INSERT_ROWS',
  requestBody: { values: filasOrdenadas },
})
const range = res.data.updates?.updatedRange ?? '?'
const updates = res.data.updates?.updatedRows ?? 0
console.log(`✓ ${updates} filas insertadas en ${range}`)
