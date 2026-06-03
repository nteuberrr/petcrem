// Read-only: analiza los valores de `categoria` y patrones en `notas`
// que sugieran tamaño de la veterinaria.
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
  range: 'mailing_veterinarios',
  valueRenderOption: 'UNFORMATTED_VALUE',
})
const [headers, ...rows] = r.data.values
const idx = (h) => headers.indexOf(h)
const iCat = idx('categoria')
const iNotas = idx('notas')
const iVet = idx('veterinaria')

console.log(`Total filas: ${rows.length}`)
console.log('')

// Distribución de categoria
const catCount = new Map()
for (const row of rows) {
  const c = (row[iCat] ?? '').toString().trim()
  catCount.set(c || '(vacío)', (catCount.get(c || '(vacío)') || 0) + 1)
}
console.log('Distribución actual de "categoria":')
Array.from(catCount.entries()).sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => console.log(`  "${k}": ${v}`))
console.log('')

// Patrones de tamaño en notas
const patterns = [
  { name: 'grande', regex: /\b(grande|big|large|alto volumen|alta demanda)\b/i },
  { name: 'mediano', regex: /\b(median[oa]|medium|medio)\b/i },
  { name: 'pequeño', regex: /\b(peque[ñn][oa]|chic[oa]|small)\b/i },
]
const inferenciaTamano = new Map()  // size → count
const sampleNotas = []
let notasNoVacias = 0
for (const row of rows) {
  const notas = (row[iNotas] ?? '').toString()
  if (notas.trim()) notasNoVacias++
  // Si contiene algo que no sea solo metadata del import
  for (const p of patterns) {
    if (p.regex.test(notas)) {
      inferenciaTamano.set(p.name, (inferenciaTamano.get(p.name) || 0) + 1)
    }
  }
}
console.log(`Notas no vacías: ${notasNoVacias}`)
console.log('')
console.log('Detecciones de tamaño en notas:')
for (const [k, v] of inferenciaTamano.entries()) {
  console.log(`  ${k}: ${v} filas`)
}
console.log('')

// Sample de notas que tengan información distinta a la metadata del import
console.log('Sample de notas NO-vacías que parecen tener info real (no solo Fuente/Cargo/RUT/Dir/Cod/Horario):')
let shown = 0
for (const row of rows) {
  const notas = (row[iNotas] ?? '').toString().trim()
  if (!notas) continue
  // Notas del import contienen patrones tipo "Cargo: X · Dir: Y · Fuente: Z"
  // Las "puras" del import son metadata. Las notas curadas a mano son distintas.
  const esDelImport = /Cargo:|Dir:|RUT:|Cod:|Horario:|Fuente:/i.test(notas)
  if (esDelImport) continue
  console.log(`  [${row[iVet] ?? '?'}] ${notas}`)
  shown++
  if (shown >= 15) break
}
console.log('')
console.log(`Mostradas ${shown} notas curadas a mano.`)
console.log('')

// Sample de notas del import que contienen mención de tamaño
console.log('Sample de notas del import con mención de tamaño:')
shown = 0
for (const row of rows) {
  const notas = (row[iNotas] ?? '').toString().trim()
  if (!notas) continue
  if (!patterns.some(p => p.regex.test(notas))) continue
  console.log(`  [${row[iVet] ?? '?'}] ${notas.slice(0, 200)}`)
  shown++
  if (shown >= 10) break
}
