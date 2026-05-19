// Normaliza los teléfonos de la hoja "clientes" a 9 dígitos sin prefijo +56,
// espacios, guiones ni paréntesis. Pasá --dry para ver qué haría sin escribir.
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

// Leer headers + datos
const res = await sheets.spreadsheets.values.get({
  spreadsheetId,
  range: 'clientes',
})
const all = res.data.values ?? []
const headers = all[0] ?? []
const colTel = headers.indexOf('telefono')
const colCodigo = headers.indexOf('codigo')
const colNombre = headers.indexOf('nombre_mascota')

if (colTel === -1) { console.error('No se encontró la columna "telefono"'); process.exit(1) }

// Fixes manuales: ciertos clientes con teléfono incompleto en la base original.
// La key es el código del cliente; el value es el teléfono final deseado.
const FIXES_MANUALES = {
  'P32-CI': '996648833', // Noah — faltaba el 9 inicial del prefijo móvil
}

function normalizar(raw) {
  if (!raw) return ''
  let soloDigitos = String(raw).replace(/\D/g, '')
  // Si tiene 11 dígitos y empieza con "56" (prefijo país Chile), quitamos los 2 primeros.
  if (soloDigitos.length === 11 && soloDigitos.startsWith('56')) soloDigitos = soloDigitos.slice(2)
  // Si tiene 10 y empieza con "5" (prefijo país parcial), quitamos.
  else if (soloDigitos.length === 10 && soloDigitos.startsWith('5')) soloDigitos = soloDigitos.slice(1)
  // Si tiene más de 9 dígitos por cualquier motivo, nos quedamos con los últimos 9.
  else if (soloDigitos.length > 9) soloDigitos = soloDigitos.slice(-9)
  // Heurística móvil chileno: si quedan 8 dígitos sin "9" al inicio, le falta el 9 del prefijo móvil.
  if (soloDigitos.length === 8 && !soloDigitos.startsWith('9')) soloDigitos = '9' + soloDigitos
  return soloDigitos
}

const cambios = []
for (let i = 1; i < all.length; i++) {
  const row = all[i]
  const original = row[colTel] ?? ''
  const codigo = row[colCodigo] ?? ''
  const normalizado = FIXES_MANUALES[codigo] ?? normalizar(original)
  if (original !== normalizado) {
    cambios.push({
      filaSheet: i + 1,
      codigo,
      mascota: row[colNombre] ?? '',
      antes: original || '(vacío)',
      despues: normalizado || '(vacío)',
      ok: normalizado.length === 9,
    })
  }
}

if (cambios.length === 0) {
  console.log('Todos los teléfonos ya están normalizados (9 dígitos exactos). Nada que hacer.')
  process.exit(0)
}

console.log(`Plan: ${cambios.length} teléfonos a normalizar\n`)
console.log('Fila  Código    Mascota                Antes                       → Después        Status')
console.log('────  ──────    ──────────             ────────                    ─ ────────       ──────')
for (const c of cambios) {
  console.log(
    `${String(c.filaSheet).padStart(4)}  ${c.codigo.padEnd(8)} ${c.mascota.slice(0, 22).padEnd(22)} ${String(c.antes).slice(0, 27).padEnd(27)} → ${c.despues.padEnd(15)} ${c.ok ? 'OK' : '⚠ NO QUEDA EN 9 DÍGITOS'}`
  )
}

const sospechosos = cambios.filter(c => !c.ok)
if (sospechosos.length > 0) {
  console.log(`\n⚠ Hay ${sospechosos.length} filas que NO van a quedar con 9 dígitos exactos después de la normalización.`)
  console.log('   Revisá esos casos manualmente antes de aplicar.')
}

if (DRY) {
  console.log('\n[DRY-RUN] No se escribió nada. Quitá --dry para aplicar.')
  process.exit(0)
}

// Aplicar: usar batchUpdate de valores
const colLetra = String.fromCharCode(65 + colTel) // funciona para col 0-25
const requests = cambios.map(c => ({
  range: `clientes!${colLetra}${c.filaSheet}`,
  values: [[c.despues]],
}))

await sheets.spreadsheets.values.batchUpdate({
  spreadsheetId,
  requestBody: {
    valueInputOption: 'USER_ENTERED',
    data: requests,
  },
})
console.log(`\n✓ Listo. ${cambios.length} teléfonos actualizados.`)
