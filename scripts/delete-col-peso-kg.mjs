// Elimina la columna legacy "peso_kg" de la hoja "clientes".
// Pasá --dry para ver qué haría sin escribir.
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
const spreadsheetId = env.GOOGLE_SPREADSHEET_ID

// Metadata para obtener sheetId de "clientes"
const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(sheetId,title))' })
const sheetId = meta.data.sheets?.find(s => s.properties.title === 'clientes')?.properties.sheetId
if (sheetId === undefined) { console.error('No se encontró la hoja "clientes"'); process.exit(1) }

// Leer datos
const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'clientes' })
const all = res.data.values ?? []
const headers = all[0] ?? []
const colIdx = headers.indexOf('peso_kg')
if (colIdx === -1) {
  console.log('La columna "peso_kg" no existe en la hoja "clientes". Nada que hacer.')
  process.exit(0)
}

// Contar valores no vacíos para visibilidad
let conValor = 0
for (let i = 1; i < all.length; i++) {
  const v = all[i]?.[colIdx]
  if (v !== undefined && v !== null && String(v).trim() !== '') conValor++
}

const letra = String.fromCharCode(65 + colIdx)
console.log(`Plan: eliminar la columna "${headers[colIdx]}" (col ${letra} = posición ${colIdx + 1}) de la hoja "clientes"`)
console.log(`  Filas totales (sin header): ${all.length - 1}`)
console.log(`  Filas con valor en esa columna: ${conValor}`)
console.log(`  Filas vacías en esa columna: ${all.length - 1 - conValor}`)

if (DRY) {
  console.log('\n[DRY-RUN] No se escribió nada. Quitá --dry para aplicar.')
  process.exit(0)
}

console.log('\nEliminando columna...')
await sheets.spreadsheets.batchUpdate({
  spreadsheetId,
  requestBody: {
    requests: [{
      deleteDimension: {
        range: {
          sheetId,
          dimension: 'COLUMNS',
          startIndex: colIdx,
          endIndex: colIdx + 1,
        },
      },
    }],
  },
})
console.log(`✓ Listo. Columna "peso_kg" eliminada. Las demás columnas se corrieron 1 posición a la izquierda.`)
