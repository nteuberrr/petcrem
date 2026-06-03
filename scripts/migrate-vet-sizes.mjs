// Migración one-shot:
// 1) Asegura columna `tamano_veterinaria` en mailing_veterinarios.
// 2) Mapea categoria A/B/C → tamano_veterinaria (grande/mediano/pequeño) y
//    categoria pasa a 'prospecto'.
// 3) Para filas con "Tamaño: X" en notas, extrae el tamaño y lo limpia de notas.
// 4) Notas que solo eran metadata del import (Cargo/Dir/RUT/Cod/Horario/Fuente)
//    quedan vacías.
//
// Uso: node scripts/migrate-vet-sizes.mjs [--apply]
//      Sin flag = dry-run con reporte.
//      Con --apply = escribe a Sheets (un solo batchUpdate).
import { google } from 'googleapis'
import { readFileSync } from 'fs'
import { resolve } from 'path'

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

// ─── Helpers ───
function colLetter(idx) {
  let s = ''
  let n = idx
  while (true) {
    s = String.fromCharCode(65 + (n % 26)) + s
    if (n < 26) return s
    n = Math.floor(n / 26) - 1
  }
}

function inferirTamanoDesdeNotas(notas) {
  const m = notas.match(/Tama[ñn]o:\s*([A-Za-zÁÉÍÓÚáéíóúÑñ]+)/i)
  if (!m) return null
  const v = m[1].toLowerCase()
  if (v.startsWith('gran')) return 'grande'
  if (v.startsWith('med'))  return 'mediano'
  if (v.startsWith('chic') || v.startsWith('pequ') || v.startsWith('small')) return 'pequeño'
  return null
}

function limpiarNotas(notas) {
  let n = notas
  // Quitar "Tamaño: X" en cualquier lugar, con separadores adyacentes
  n = n.replace(/\s*·\s*Tama[ñn]o:\s*[A-Za-zÁÉÍÓÚáéíóúÑñ]+/gi, '')
  n = n.replace(/Tama[ñn]o:\s*[A-Za-zÁÉÍÓÚáéíóúÑñ]+\s*·\s*/gi, '')
  n = n.replace(/^Tama[ñn]o:\s*[A-Za-zÁÉÍÓÚáéíóúÑñ]+$/gi, '')
  n = n.trim()
  // Si las partes restantes son TODAS metadata del import, vaciar
  const partes = n.split('·').map(p => p.trim()).filter(Boolean)
  const todasMetadata = partes.length > 0 &&
    partes.every(p => /^(Cargo|Dir|RUT|Cod|Horario|Fuente):/i.test(p))
  if (todasMetadata) return ''
  return n
}

function migrarCategoria(catRaw) {
  const c = (catRaw ?? '').toString().trim().toUpperCase()
  if (c === 'A') return { tamano: 'grande',  nuevaCat: 'prospecto' }
  if (c === 'B') return { tamano: 'mediano', nuevaCat: 'prospecto' }
  if (c === 'C') return { tamano: 'pequeño', nuevaCat: 'prospecto' }
  return { tamano: '', nuevaCat: catRaw ?? '' }
}

// ─── 1) Leer hoja y headers ───
console.log('Leyendo mailing_veterinarios...')
const r0 = await sheets.spreadsheets.values.get({
  spreadsheetId: env.GOOGLE_SPREADSHEET_ID,
  range: 'mailing_veterinarios',
  valueRenderOption: 'UNFORMATTED_VALUE',
})
const headers = r0.data.values?.[0] ?? []
let dataRows = r0.data.values?.slice(1) ?? []

// ─── 2) Asegurar columna tamano_veterinaria ───
let iTamano = headers.indexOf('tamano_veterinaria')
const necesitaAgregarCol = iTamano === -1
if (necesitaAgregarCol) {
  iTamano = headers.length
  console.log(`Falta columna 'tamano_veterinaria'. Se agregará al final (col ${colLetter(iTamano)}).`)
} else {
  console.log(`Columna 'tamano_veterinaria' ya existe en col ${colLetter(iTamano)}.`)
}

const iCat = headers.indexOf('categoria')
const iNotas = headers.indexOf('notas')

// ─── 3) Calcular plan ───
let cambios = 0
let migracionesABC = { A: 0, B: 0, C: 0 }
let inferenciasNotas = 0
let notasBorradas = 0
let notasModificadas = 0

const filasFinales = dataRows.map((row) => {
  const out = row.slice()
  while (out.length <= iTamano) out.push('')
  const catRaw = out[iCat] ?? ''
  const notasRaw = (out[iNotas] ?? '').toString()

  // Migrar categoria A/B/C
  const { tamano: tamanoDeCat, nuevaCat } = migrarCategoria(catRaw)

  // Si no obtuvimos tamaño de la categoría, buscar en notas
  let tamano = tamanoDeCat
  if (!tamano && notasRaw) {
    const t = inferirTamanoDesdeNotas(notasRaw)
    if (t) { tamano = t; inferenciasNotas++ }
  }

  // Limpiar notas (siempre intentar quitar la parte de "Tamaño: X")
  const notasLimpias = limpiarNotas(notasRaw)
  if (notasLimpias !== notasRaw.trim()) {
    if (notasLimpias === '') notasBorradas++
    else notasModificadas++
  }

  // Contar A/B/C
  const C = catRaw.toString().trim().toUpperCase()
  if (C === 'A') migracionesABC.A++
  else if (C === 'B') migracionesABC.B++
  else if (C === 'C') migracionesABC.C++

  // Detectar si hubo algún cambio respecto al original
  const hayCambioCat = (out[iCat] ?? '') !== nuevaCat
  const hayCambioNotas = (out[iNotas] ?? '') !== notasLimpias
  const hayTamano = tamano !== ''
  if (hayCambioCat || hayCambioNotas || hayTamano) cambios++

  out[iCat] = nuevaCat
  out[iNotas] = notasLimpias
  out[iTamano] = tamano
  return out
})

console.log('')
console.log('═══ Plan de migración ═══')
console.log(`Filas totales:                 ${dataRows.length}`)
console.log(`A → grande:                    ${migracionesABC.A}`)
console.log(`B → mediano:                   ${migracionesABC.B}`)
console.log(`C → pequeño:                   ${migracionesABC.C}`)
console.log(`Inferidos desde notas:         ${inferenciasNotas}`)
console.log(`Notas borradas (metadata):     ${notasBorradas}`)
console.log(`Notas modificadas (parcial):   ${notasModificadas}`)
console.log(`Filas con algún cambio:        ${cambios}`)
console.log('')

// Sample
console.log('Sample (3 filas con cambios significativos):')
let shown = 0
for (let i = 0; i < dataRows.length && shown < 3; i++) {
  const orig = dataRows[i]
  const next = filasFinales[i]
  if (orig[iCat] !== next[iCat] || (orig[iNotas] ?? '') !== next[iNotas] || next[iTamano]) {
    console.log(`  [${next[headers.indexOf('veterinaria')] || '?'}]`)
    console.log(`     categoria: "${orig[iCat] ?? ''}" → "${next[iCat]}"`)
    console.log(`     tamano:    → "${next[iTamano]}"`)
    console.log(`     notas:     "${(orig[iNotas] ?? '').toString().slice(0, 100)}"`)
    console.log(`            → "${next[iNotas]}"`)
    shown++
  }
}
console.log('')

if (!APPLY) {
  console.log('DRY RUN — sin --apply no se escribe nada.')
  console.log('Para aplicar: node scripts/migrate-vet-sizes.mjs --apply')
  process.exit(0)
}

// ─── 4) Aplicar cambios ───
const range = `mailing_veterinarios!A1:${colLetter(iTamano)}${filasFinales.length + 1}`
const nuevosHeaders = headers.slice()
while (nuevosHeaders.length <= iTamano) nuevosHeaders.push('')
nuevosHeaders[iTamano] = 'tamano_veterinaria'

const values = [nuevosHeaders, ...filasFinales]
console.log(`Escribiendo ${values.length - 1} filas + headers en ${range} ...`)
const res = await sheets.spreadsheets.values.update({
  spreadsheetId: env.GOOGLE_SPREADSHEET_ID,
  range,
  valueInputOption: 'USER_ENTERED',
  requestBody: { values },
})
console.log(`✓ Migración aplicada (${res.data.updatedRows} filas actualizadas).`)
