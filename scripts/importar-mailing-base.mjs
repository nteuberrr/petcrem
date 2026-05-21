// Importa la "Base de Veterinarios.xlsx" a la hoja mailing_veterinarios.
// Uso:
//   node scripts/importar-mailing-base.mjs                       # dry-run, muestra qué cargaría
//   node scripts/importar-mailing-base.mjs --apply               # carga real al Sheet
//
// Necesita en .env.local: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SPREADSHEET_ID

import { createRequire } from 'module'
import { google } from 'googleapis'
import { existsSync } from 'fs'

const require = createRequire(import.meta.url)
const xlsx = require('xlsx-js-style')

const XLSX_PATH = 'C:/Users/Nicolas/Downloads/Base de Veterinarios.xlsx'
const APPLY = process.argv.includes('--apply')
const SHEET = 'mailing_veterinarios'

if (!existsSync(XLSX_PATH)) {
  console.error('No existe:', XLSX_PATH)
  process.exit(1)
}

function getSheets() {
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  return google.sheets({ version: 'v4', auth })
}

// ============== Helpers ==============

function trimSpaces(s) {
  return String(s ?? '').trim().replace(/\s+/g, ' ')
}

function isValidEmail(s) {
  if (!s) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
}

function normalizeTelefono(raw) {
  if (raw == null || raw === '') return ''
  let s = String(raw).replace(/\D/g, '')  // solo dígitos
  if (s.length === 11 && s.startsWith('56')) s = s.slice(2)
  if (s.length === 10 && s.startsWith('0')) s = s.slice(1)  // ej "0993..."
  if (s.length === 9) return s
  return ''
}

function combineNotas(parts) {
  const seen = new Set()
  const out = []
  for (const p of parts) {
    const txt = trimSpaces(p)
    if (!txt || txt === '-' || txt === '0' || txt.toLowerCase() === 'n/a') continue
    const k = txt.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(txt)
  }
  return out.join(' · ')
}

// ============== Lectura ==============

const wb = xlsx.readFile(XLSX_PATH)
const sheet1 = xlsx.utils.sheet_to_json(wb.Sheets['Veterinarias'], { defval: '', raw: true })
const sheet2 = xlsx.utils.sheet_to_json(wb.Sheets['VET 2'], { defval: '', raw: true })

console.log(`\nLeídas ${sheet1.length} filas de "Veterinarias" y ${sheet2.length} filas de "VET 2"`)

const procesados = []
const descartados = []

// Hoja 1: Veterinarias
for (const r of sheet1) {
  const email = trimSpaces(r['Mail']).toLowerCase()
  const nombre = trimSpaces(r['Contacto'])
  const veterinaria = trimSpaces(r['Clinica Veterinaria'])
  const comuna = trimSpaces(r['Comuna'])
  const telefono = normalizeTelefono(r['Telefono'])
  const notas = combineNotas([
    r['Crematorio Actual'] && `Cremat. actual: ${r['Crematorio Actual']}`,
    r['Tamaño Clinica'] && `Tamaño: ${r['Tamaño Clinica']}`,
    r['Cargo'] && `Cargo: ${r['Cargo']}`,
    r['Comentario'],
    r['Comentario 2'],
  ])

  if (!isValidEmail(email)) {
    descartados.push({ hoja: 'Veterinarias', veterinaria, motivo: 'sin email válido', valor: r['Mail'] })
    continue
  }
  procesados.push({
    _origen: 'Veterinarias',
    nombre, email, veterinaria, comuna, telefono,
    categoria: 'prospecto',
    suscrito: 'TRUE',
    notas,
  })
}

// Hoja 2: VET 2
for (const r of sheet2) {
  const email = trimSpaces(r['Email']).toLowerCase()
  const nombre = (() => {
    const n = trimSpaces(r['Nombre veterinario'])
    return (n === '?' || n === '-' || !n) ? '' : n
  })()
  const veterinaria = trimSpaces(r['Veterinaria'])
  const comuna = trimSpaces(r['Comuna'])
  const telefono = normalizeTelefono(r['Teléfono'])
  const notas = combineNotas([
    r['¿Realiza eutanasia?'] === 'SI' && 'Hace eutanasias',
    r['Precio Eutanasia 15kg (domicilio)'] && `Precio eut. 15kg: ${r['Precio Eutanasia 15kg (domicilio)']}`,
    r['¿Visitada?'] === 'SI' && r['Fecha visita'] && `Visitada ${r['Fecha visita']}`,
    r['Observaciones'],
  ])

  if (!isValidEmail(email)) {
    descartados.push({ hoja: 'VET 2', veterinaria, motivo: 'sin email válido', valor: r['Email'] })
    continue
  }
  procesados.push({
    _origen: 'VET 2',
    nombre, email, veterinaria, comuna, telefono,
    categoria: 'prospecto',
    suscrito: 'TRUE',
    notas,
  })
}

// Dedup por email (merge: el primero se queda + completa campos vacíos del segundo)
const map = new Map()
const duplicados = []
for (const p of procesados) {
  const k = p.email
  if (!map.has(k)) {
    map.set(k, p)
  } else {
    const existing = map.get(k)
    duplicados.push({ email: k, origen1: existing._origen, origen2: p._origen })
    // Llenar campos vacíos
    for (const field of ['nombre', 'veterinaria', 'comuna', 'telefono', 'notas']) {
      if (!existing[field] && p[field]) existing[field] = p[field]
    }
  }
}
const finales = Array.from(map.values())

console.log(`\n=== Resumen ===`)
console.log(`Total leído:       ${sheet1.length + sheet2.length}`)
console.log(`Procesados (OK):   ${procesados.length}`)
console.log(`Descartados:       ${descartados.length}`)
console.log(`Duplicados (merge):${duplicados.length}`)
console.log(`Únicos finales:    ${finales.length}`)

// Telefonos normalizados
const conTel = finales.filter(f => f.telefono).length
console.log(`Con teléfono 9 dígitos: ${conTel} / ${finales.length}`)

console.log('\n=== Preview primeros 10 ===')
finales.slice(0, 10).forEach((f, i) => {
  console.log(`${i + 1}.`, JSON.stringify({
    nombre: f.nombre, email: f.email, veterinaria: f.veterinaria,
    comuna: f.comuna, telefono: f.telefono, notas: f.notas.slice(0, 80),
  }))
})

if (descartados.length > 0) {
  console.log('\n=== Descartados (primeros 10) ===')
  descartados.slice(0, 10).forEach(d => console.log(` [${d.hoja}] ${d.veterinaria}: ${d.motivo} → "${d.valor}"`))
  if (descartados.length > 10) console.log(`   ... y ${descartados.length - 10} más`)
}

if (duplicados.length > 0) {
  console.log('\n=== Duplicados detectados ===')
  duplicados.forEach(d => console.log(` ${d.email} (en ${d.origen1} y ${d.origen2}, mergeados)`))
}

if (!APPLY) {
  console.log('\n⚠️  Esto fue dry-run. Para cargar de verdad: node scripts/importar-mailing-base.mjs --apply')
  process.exit(0)
}

// ============== APPLY ==============

const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID
if (!spreadsheetId) {
  console.error('Falta GOOGLE_SPREADSHEET_ID')
  process.exit(1)
}

console.log('\n🔴 APPLY MODE — cargando al sheet...')

const sheets = getSheets()

// 1) Leer headers existentes para saber qué orden poner
const headersRes = await sheets.spreadsheets.values.get({
  spreadsheetId,
  range: `${SHEET}!1:1`,
})
const headers = (headersRes.data.values?.[0] ?? [])
if (headers.length === 0) {
  console.error('La hoja mailing_veterinarios no tiene headers. Corré /api/init-sheets primero.')
  process.exit(1)
}

// 2) Chequear emails ya existentes en la hoja para no duplicar
const existingRes = await sheets.spreadsheets.values.get({
  spreadsheetId,
  range: SHEET,
})
const existingRows = existingRes.data.values ?? []
const emailColIdx = headers.indexOf('email')
const idColIdx = headers.indexOf('id')
const existingEmails = new Set(
  existingRows.slice(1)
    .map(r => (r[emailColIdx] || '').toString().toLowerCase())
    .filter(Boolean)
)
let nextId = Math.max(0, ...existingRows.slice(1)
  .map(r => parseInt(r[idColIdx] || '0', 10))
  .filter(n => !isNaN(n))) + 1

const hoy = new Date().toISOString().split('T')[0]
const aCargar = []
let saltados = 0
for (const f of finales) {
  if (existingEmails.has(f.email)) {
    saltados++
    continue
  }
  const row = headers.map(h => {
    switch (h) {
      case 'id': return String(nextId++)
      case 'nombre': return f.nombre
      case 'email': return f.email
      case 'veterinaria': return f.veterinaria
      case 'comuna': return f.comuna
      case 'telefono': return f.telefono
      case 'categoria': return f.categoria
      case 'suscrito': return f.suscrito
      case 'notas': return f.notas
      case 'fecha_creacion': return hoy
      default: return ''
    }
  })
  aCargar.push(row)
}

console.log(`A cargar: ${aCargar.length} (${saltados} ya existían en la hoja)`)

if (aCargar.length === 0) {
  console.log('Nada para cargar.')
  process.exit(0)
}

// 3) Append en una sola llamada
await sheets.spreadsheets.values.append({
  spreadsheetId,
  range: SHEET,
  valueInputOption: 'USER_ENTERED',
  requestBody: { values: aCargar },
})

console.log(`✅ Cargados ${aCargar.length} veterinarios.`)
