// Aplica los cambios del xlsx a mailing_veterinarios:
// - Actualiza 351 existentes con datos distintos (sobreescribe campos que difieren).
// - Inserta 48 nuevos.
// Preserva id, suscrito, notas, fecha_creacion y categoria de los existentes.
// Para los nuevos, si no hay contacto ni veterinaria, usa el email como nombre.
//
// Uso: node scripts/apply-vets-update.mjs [--apply]
//      Sin flag = dry-run (sin escribir).
//      --apply = ejecuta los cambios.
import { google } from 'googleapis'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import XLSX from 'xlsx-js-style'

const XLSX_PATH = 'G:/Mi unidad/2. Industrias NC/Veterinarios/Base de datos veterinarios.xlsx'
const APPLY = process.argv.includes('--apply')

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
function mapTamano(s) {
  const t = clean(s).toUpperCase()
  if (t === 'A') return 'grande'
  if (t === 'B') return 'mediano'
  if (t === 'C') return 'pequeño'
  if (t === 'GRANDE' || t === 'MEDIANO' || t === 'PEQUEÑO') return clean(s).toLowerCase()
  return ''
}
function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function colLetter(idx) {
  let s = '', n = idx
  while (true) {
    s = String.fromCharCode(65 + (n % 26)) + s
    if (n < 26) return s
    n = Math.floor(n / 26) - 1
  }
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

const HEADERS = mailing.headers
const idxByEmail = new Map()
mailing.rows.forEach((r, i) => {
  const e = normEmail(r.email)
  if (e) idxByEmail.set(e, i)
})
const crmEmails = new Set(crm.rows.map(r => normEmail(r.correo)).filter(Boolean))

// Construir candidatos
const seen = new Set()
const candidatos = []
for (const r of rawRows) {
  const email = normEmail(r.Mail)
  if (!email || seen.has(email)) continue
  seen.add(email)
  if (crmEmails.has(email)) continue
  const veterinaria = clean(r['Clinica Veterinaria'])
  const contacto = clean(r.Contacto)
  candidatos.push({
    email,
    nombre: contacto || veterinaria,
    veterinaria,
    comuna: clean(r.Comuna),
    telefono: clean(r.Telefono),
    tamano_veterinaria: mapTamano(r['Tamaño Clinica']),
  })
}

// Separar en updates e inserts
const updates = []  // { rowIndex, current, next, diffs }
const inserts = []
for (const cand of candidatos) {
  const i = idxByEmail.get(cand.email)
  if (i === undefined) {
    // Nuevo: si no hay contacto ni veterinaria, usar email como nombre
    if (!cand.nombre) cand.nombre = cand.email
    inserts.push(cand)
    continue
  }
  const current = mailing.rows[i]
  // Calcular el row "updated" preservando campos que no vienen del xlsx
  const next = { ...current }
  const diffs = []
  for (const campo of ['nombre', 'veterinaria', 'comuna', 'telefono', 'tamano_veterinaria']) {
    const a = clean(current[campo])
    const n = clean(cand[campo])
    if (n && a !== n) {
      diffs.push({ campo, actual: a, nuevo: n })
      next[campo] = n
    }
  }
  if (diffs.length > 0) {
    updates.push({ rowIndex: i, current, next, diffs })
  }
}

console.log('')
console.log('═══ Plan ═══')
console.log(`Updates:  ${updates.length}`)
console.log(`Inserts:  ${inserts.length}`)
console.log('')

if (updates.length > 0) {
  console.log('Sample de updates (primeros 3):')
  updates.slice(0, 3).forEach((u, i) => {
    console.log(`  [${i + 1}] ${u.current.veterinaria} <${u.current.email}>`)
    u.diffs.forEach(d => console.log(`        ${d.campo}: "${d.actual}" → "${d.nuevo}"`))
  })
  console.log('')
}
if (inserts.length > 0) {
  console.log('Sample de inserts (primeros 3):')
  inserts.slice(0, 3).forEach((n, i) => {
    console.log(`  [${i + 1}] ${n.veterinaria || '(sin nombre)'} | ${n.email} | nombre asignado: "${n.nombre}"`)
  })
  console.log('')
}

if (!APPLY) {
  console.log('DRY RUN — sin --apply no se escribe nada.')
  console.log('Para aplicar: node scripts/apply-vets-update.mjs --apply')
  process.exit(0)
}

// ─── Aplicar updates con values.batchUpdate (una sola llamada) ───
if (updates.length > 0) {
  console.log(`Aplicando ${updates.length} updates en batch...`)
  const lastColIdx = HEADERS.length - 1
  const endCol = colLetter(lastColIdx)
  const data = updates.map(u => {
    const sheetRow = u.rowIndex + 2  // header en 1, datos desde 2
    const row = HEADERS.map(h => u.next[h] ?? '')
    return {
      range: `mailing_veterinarios!A${sheetRow}:${endCol}${sheetRow}`,
      values: [row],
    }
  })
  const res = await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: env.GOOGLE_SPREADSHEET_ID,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  })
  console.log(`✓ ${res.data.totalUpdatedRows ?? updates.length} filas actualizadas`)
}

// ─── Aplicar inserts con values.append (una sola llamada) ───
if (inserts.length > 0) {
  // Calcular próximo id
  const ids = mailing.rows.map(r => parseInt(r.id, 10)).filter(n => Number.isFinite(n))
  const maxId = ids.length > 0 ? Math.max(...ids) : 0
  const fecha = todayISO()
  const values = inserts.map((n, i) => {
    const row = {
      id: String(maxId + i + 1),
      nombre: n.nombre,
      email: n.email,
      veterinaria: n.veterinaria,
      comuna: n.comuna,
      telefono: n.telefono,
      categoria: 'prospecto',
      tamano_veterinaria: n.tamano_veterinaria,
      suscrito: 'TRUE',
      notas: '',
      fecha_creacion: fecha,
    }
    return HEADERS.map(h => row[h] ?? '')
  })
  console.log(`Insertando ${inserts.length} filas nuevas...`)
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: env.GOOGLE_SPREADSHEET_ID,
    range: 'mailing_veterinarios',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  })
  console.log(`✓ ${res.data.updates?.updatedRows ?? inserts.length} filas insertadas en ${res.data.updates?.updatedRange ?? '?'}`)
}

console.log('')
console.log('Listo.')
