// Imprime los headers reales de la hoja "clientes" con su letra de columna,
// para detectar columnas legacy o discrepancias con el schema del código.
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

const res = await sheets.spreadsheets.values.get({
  spreadsheetId: env.GOOGLE_SPREADSHEET_ID,
  range: 'clientes!1:1',
})
const headers = res.data.values?.[0] ?? []

const letra = (i) => {
  let n = i, s = ''
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1 } while (n >= 0)
  return s
}

console.log('Columnas reales en hoja "clientes":\n')
headers.forEach((h, i) => console.log(`  ${letra(i).padEnd(3)} (col ${i + 1}) → ${h}`))
console.log(`\nTotal: ${headers.length} columnas`)
