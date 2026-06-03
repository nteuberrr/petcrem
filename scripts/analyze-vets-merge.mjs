// Analiza el xlsx local vs. las hojas `veterinarios` y `mailing_veterinarios` de la planilla.
// NO modifica nada. Solo reporta dups, nuevos netos y sample.
// Uso: node scripts/analyze-vets-merge.mjs
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

function normEmail(s) {
  return (s ?? '').toString().trim().toLowerCase()
}

async function readSheet(name) {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: env.GOOGLE_SPREADSHEET_ID,
    range: name,
    valueRenderOption: 'UNFORMATTED_VALUE',
  })
  const all = r.data.values ?? []
  if (all.length < 2) return []
  const h = all[0]
  return all.slice(1).map(row => {
    const o = {}
    h.forEach((k, i) => { o[k] = (row[i] ?? '').toString() })
    return o
  })
}

console.log('Leyendo xlsx local...')
const buf = readFileSync(XLSX_PATH)
const wb = XLSX.read(buf, { type: 'buffer' })
const ws = wb.Sheets[wb.SheetNames[0]]
const rawRows = XLSX.utils.sheet_to_json(ws, { defval: '' })

console.log('Leyendo hojas de Google Sheets...')
const [vets, mvets] = await Promise.all([
  readSheet('veterinarios'),
  readSheet('mailing_veterinarios'),
])

const mvetsByEmail = new Map(mvets.filter(r => r.email).map(r => [normEmail(r.email), r]))
const vetsByEmail = new Map(vets.filter(r => r.correo).map(r => [normEmail(r.correo), r]))

const totalXlsx = rawRows.length
const conEmail = rawRows.filter(r => normEmail(r.Mail)).length
const sinEmail = totalXlsx - conEmail

// Dedup interno del xlsx por email
const seenLocal = new Set()
const duplicadosInternos = []
const xlsxUnicos = []
for (const r of rawRows) {
  const e = normEmail(r.Mail)
  if (!e) continue
  if (seenLocal.has(e)) {
    duplicadosInternos.push(e)
  } else {
    seenLocal.add(e)
    xlsxUnicos.push(r)
  }
}

const yaEnMailing = []
const yaEnVeterinarios = []
const nuevosNetos = []
for (const r of xlsxUnicos) {
  const e = normEmail(r.Mail)
  if (mvetsByEmail.has(e)) yaEnMailing.push(r)
  else if (vetsByEmail.has(e)) yaEnVeterinarios.push(r)
  else nuevosNetos.push(r)
}

console.log('')
console.log('═══ Reporte ═══')
console.log(`Filas en el xlsx:                 ${totalXlsx}`)
console.log(`  con email válido:               ${conEmail}`)
console.log(`  sin email (no son útiles):      ${sinEmail}`)
console.log(`  duplicados dentro del xlsx:     ${duplicadosInternos.length}`)
console.log(`  únicos del xlsx:                ${xlsxUnicos.length}`)
console.log('')
console.log(`Filas en mailing_veterinarios:    ${mvets.length}`)
console.log(`Filas en veterinarios (CRM):      ${vets.length}`)
console.log('')
console.log(`Ya en mailing_veterinarios:       ${yaEnMailing.length}  → skip`)
console.log(`Ya en veterinarios (CRM):         ${yaEnVeterinarios.length}  → ¿skip o sumar a mailing?`)
console.log(`Nuevos netos para mailing:        ${nuevosNetos.length}`)
console.log('')
console.log('Sample de nuevos netos (primeros 5):')
nuevosNetos.slice(0, 5).forEach((r, i) => {
  console.log(`  [${i + 1}] ${r['Clinica Veterinaria']} | ${r.Mail} | ${r.Comuna || '—'} | ${r.Telefono || '—'}`)
})
console.log('')
console.log('Comunas representadas en nuevos netos (top 10):')
const porComuna = new Map()
for (const r of nuevosNetos) {
  const c = (r.Comuna || 'Sin comuna').trim()
  porComuna.set(c, (porComuna.get(c) || 0) + 1)
}
Array.from(porComuna.entries())
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .forEach(([k, v]) => console.log(`  ${k}: ${v}`))
console.log('')
console.log('Fuentes:')
const porFuente = new Map()
for (const r of xlsxUnicos) {
  const f = (r.Fuente || '—').trim()
  porFuente.set(f, (porFuente.get(f) || 0) + 1)
}
Array.from(porFuente.entries())
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => console.log(`  ${k}: ${v}`))
