// Verifica si la columna peso_kg tiene datos únicos que se perderían al borrarla
// (filas donde peso_kg tiene valor pero peso_declarado y peso_ingreso están vacíos).
import { google } from 'googleapis'
import { readFileSync } from 'fs'
import { resolve } from 'path'

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

const r = await sheets.spreadsheets.values.get({
  spreadsheetId: env.GOOGLE_SPREADSHEET_ID,
  range: 'clientes',
  valueRenderOption: 'UNFORMATTED_VALUE',
})
const all = r.data.values ?? []
const h = all[0] ?? []
const cKg = h.indexOf('peso_kg')
const cD = h.indexOf('peso_declarado')
const cI = h.indexOf('peso_ingreso')

let unicos = 0
for (let i = 1; i < all.length; i++) {
  const row = all[i] || []
  const kg = row[cKg]
  const d = row[cD]
  const ing = row[cI]
  const tieneKg = kg !== undefined && kg !== '' && kg !== null
  const tieneOtros = (d !== undefined && d !== '' && d !== null) || (ing !== undefined && ing !== '' && ing !== null)
  if (tieneKg && !tieneOtros) {
    unicos++
    console.log(`  Fila ${i + 1} (id=${row[0]}, código=${row[1]}, mascota=${row[2]}): peso_kg=${kg}`)
  }
}
console.log(`\nFilas con dato único en peso_kg (perderían valor al borrar): ${unicos}`)
