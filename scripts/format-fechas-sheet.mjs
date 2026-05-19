// Aplica formato visual "DD-MM-YYYY" a todas las columnas de fecha de las hojas
// y "HH:MM" a las columnas de hora. Idempotente: solo cambia el formato visual,
// no toca los datos. Pasá --dry para ver qué haría sin escribir.
import { google } from 'googleapis'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const DRY = process.argv.includes('--dry')

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

// Columnas a formatear por cada hoja. Las que tengan substrings "fecha" o "hora"
// se detectan automáticamente leyendo los headers.
const HOJAS = [
  'clientes', 'ciclos', 'cargas_petroleo', 'vehiculo_cargas', 'despachos',
  'rendiciones', 'pagos_rendicion', 'veterinarios', 'asistencia',
  'jornada_config', 'retiros_adicionales', 'pagos_retiros', 'certificados',
]

const spreadsheetId = env.GOOGLE_SPREADSHEET_ID

// 1. Leer metadata (sheetIds) y headers de cada hoja
const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(sheetId,title))' })
const sheetIdMap = {}
for (const s of meta.data.sheets ?? []) {
  sheetIdMap[s.properties.title] = s.properties.sheetId
}

const requests = []
const plan = []

for (const hoja of HOJAS) {
  const sheetId = sheetIdMap[hoja]
  if (sheetId === undefined) { console.warn(`(skip) hoja no encontrada: ${hoja}`); continue }
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${hoja}!1:1` })
  const headers = res.data.values?.[0] ?? []

  headers.forEach((h, colIdx) => {
    const name = String(h || '').toLowerCase()
    if (!name) return

    const esFecha = /^fecha(_|$)/.test(name) || name === 'vigente_desde'
    const esHora = name.startsWith('hora') || name === 'hora_entrada' || name === 'hora_salida' || name === 'hora_emision'

    if (!esFecha && !esHora) return

    const pattern = esFecha ? 'dd-mm-yyyy' : 'hh:mm'
    plan.push({ hoja, col: colIdx, header: h, pattern })

    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1, // saltar headers (fila 0)
          startColumnIndex: colIdx,
          endColumnIndex: colIdx + 1,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: esFecha ? 'DATE' : 'TIME', pattern },
          },
        },
        fields: 'userEnteredFormat.numberFormat',
      },
    })
  })
}

if (plan.length === 0) {
  console.log('No se encontraron columnas de fecha/hora.')
  process.exit(0)
}

console.log(`Plan: aplicar formato a ${plan.length} columnas:\n`)
for (const p of plan) {
  console.log(`  ${p.hoja.padEnd(22)} col ${String(p.col + 1).padStart(2)}  ${p.header.padEnd(20)} → ${p.pattern}`)
}

if (DRY) {
  console.log('\n[DRY-RUN] No se escribió nada. Quitá --dry para aplicar.')
  process.exit(0)
}

console.log('\nAplicando formato...')
await sheets.spreadsheets.batchUpdate({
  spreadsheetId,
  requestBody: { requests },
})
console.log(`✓ Listo. ${requests.length} columnas formateadas.`)
