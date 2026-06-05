// Lee los tramos peso_min/peso_max de precios_generales y los replica en
// precios_eutanasia con una tarifa progresiva entre PRECIO_MIN y PRECIO_MAX.
//
// Uso:
//   node scripts/seed-precios-eutanasia.mjs           # dry-run (solo imprime)
//   node scripts/seed-precios-eutanasia.mjs --apply   # escribe
//
// La progresión es lineal: para N tramos, el primer tramo queda en PRECIO_MIN
// y el último en PRECIO_MAX, repartiendo el resto uniformemente.

import { google } from 'googleapis'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const PRECIO_MIN = 60000
const PRECIO_MAX = 120000

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
const apply = process.argv.includes('--apply')

// 1. Leer precios_generales
const gen = await sheets.spreadsheets.values.get({
  spreadsheetId,
  range: 'precios_generales',
  valueRenderOption: 'UNFORMATTED_VALUE',
})
const rows = gen.data.values ?? []
if (rows.length < 2) {
  console.error('precios_generales está vacía o no tiene tramos.')
  process.exit(1)
}
const headers = rows[0]
const iMin = headers.indexOf('peso_min')
const iMax = headers.indexOf('peso_max')
if (iMin === -1 || iMax === -1) {
  console.error(`No encontré columnas peso_min/peso_max en encabezados: ${headers.join(', ')}`)
  process.exit(1)
}

const tramos = rows.slice(1)
  .map(r => ({ peso_min: r[iMin], peso_max: r[iMax] }))
  .filter(t => t.peso_min !== '' && t.peso_max !== '' && t.peso_min != null && t.peso_max != null)
  .sort((a, b) => parseFloat(a.peso_min) - parseFloat(b.peso_min))

console.log(`Tramos detectados en precios_generales: ${tramos.length}`)
tramos.forEach((t, i) => console.log(`  ${i + 1}. ${t.peso_min} – ${t.peso_max} kg`))

// 2. Calcular progresión lineal entre PRECIO_MIN y PRECIO_MAX
const n = tramos.length
const conPrecio = tramos.map((t, i) => {
  const precio = n === 1
    ? PRECIO_MIN
    : Math.round(PRECIO_MIN + ((PRECIO_MAX - PRECIO_MIN) * i) / (n - 1))
  return { ...t, precio }
})

console.log('\nProgresión calculada:')
conPrecio.forEach((t, i) => {
  console.log(`  ${i + 1}. ${t.peso_min} – ${t.peso_max} kg → $${t.precio.toLocaleString('es-CL')}`)
})

if (!apply) {
  console.log('\n(dry-run) Para aplicar: node scripts/seed-precios-eutanasia.mjs --apply')
  process.exit(0)
}

// 3. Asegurar que la hoja exista con sus headers
const meta = await sheets.spreadsheets.get({ spreadsheetId })
const existsSheet = (meta.data.sheets ?? []).some(s => s.properties?.title === 'precios_eutanasia')
if (!existsSheet) {
  console.log('Creando hoja precios_eutanasia…')
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: 'precios_eutanasia' } } }] },
  })
}

// 4. Leer headers actuales y escribirlos si están vacíos
const headRes = await sheets.spreadsheets.values.get({
  spreadsheetId, range: 'precios_eutanasia!1:1',
})
const currentHeaders = headRes.data.values?.[0] ?? []
if (currentHeaders.length === 0) {
  await sheets.spreadsheets.values.update({
    spreadsheetId, range: 'precios_eutanasia!1:1',
    valueInputOption: 'RAW',
    requestBody: { values: [['id', 'peso_min', 'peso_max', 'precio']] },
  })
  console.log('Headers escritos.')
}

// 5. Leer filas existentes para saber qué id usar y advertir si ya hay datos
const dataRes = await sheets.spreadsheets.values.get({
  spreadsheetId, range: 'precios_eutanasia',
  valueRenderOption: 'UNFORMATTED_VALUE',
})
const existingRows = (dataRes.data.values ?? []).slice(1)
if (existingRows.length > 0) {
  console.log(`\n⚠ Ya hay ${existingRows.length} tramos en precios_eutanasia. Este script SOLO agrega; no borra ni reemplaza.`)
  console.log('Si querés reemplazar, borra las filas existentes desde la planilla y volvé a correr.')
  console.log('Abortando para no duplicar.')
  process.exit(0)
}

// 6. Insertar tramos
const nuevos = conPrecio.map((t, i) => [
  String(i + 1),
  String(t.peso_min),
  String(t.peso_max),
  String(t.precio),
])
await sheets.spreadsheets.values.append({
  spreadsheetId,
  range: 'precios_eutanasia',
  valueInputOption: 'RAW',
  insertDataOption: 'INSERT_ROWS',
  requestBody: { values: nuevos },
})
console.log(`\n✓ ${nuevos.length} tramos insertados en precios_eutanasia.`)
