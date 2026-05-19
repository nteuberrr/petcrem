// Aplica formato visual NUMBER a las columnas numéricas (pesos, litros, montos,
// precios, etc.) de todas las hojas. Esto evita que Google Sheets las interprete
// como fechas/horas al auto-formatear. Idempotente: solo cambia el formato visual.
//
// Pasá --dry para ver qué haría sin escribir.
//
// Adicionalmente reporta celdas con valores sospechosos (entre 0 y 1, que pueden
// venir de una "hora" mal interpretada — ej. "14:12" se guarda como 0.59...).
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

const HOJAS = [
  'clientes', 'ciclos', 'cargas_petroleo', 'vehiculo_cargas',
  'rendiciones', 'pagos_rendicion',
  'precios_generales', 'precios_convenio', 'precios_especiales',
  'productos', 'otros_servicios',
  'asistencia', 'jornada_config', 'pagos_retiros',
]

// Devuelve { pattern, type } o null si no es columna numérica conocida
function detectarFormato(nombreCol) {
  const n = String(nombreCol || '').toLowerCase()
  if (!n) return null

  // Pesos: 1-2 decimales
  if (n === 'peso_declarado' || n === 'peso_ingreso' || n === 'peso_kg' || n === 'peso_total' || n === 'peso_min' || n === 'peso_max') {
    return { pattern: '0.0#', label: 'peso (kg)' }
  }
  // Ratios con decimal
  if (n === 'lt_kg' || n === 'lt_mascota' || n === 'lt_ciclo') return { pattern: '0.0', label: 'ratio' }
  // Temperatura
  if (n.includes('temperatura')) return { pattern: '0.#', label: 'temperatura' }
  // Litros y conteos enteros
  if (n === 'litros' || n === 'litros_inicio' || n === 'litros_fin' || n === 'stock' || n === 'km_odometro' || n === 'cantidad' || n === 'tolerancia_minutos') {
    return { pattern: '0', label: 'entero' }
  }
  // Minutos
  if (n.startsWith('minutos_')) return { pattern: '0', label: 'minutos' }
  // Plazos
  if (n === 'plazo_entrega_dias') return { pattern: '0', label: 'días' }
  // Precios/montos (CLP, sin decimales)
  if (n.startsWith('precio') || n === 'monto' || n === 'monto_total' || n === 'iva' || n === 'especifico' || n === 'total_bruto') {
    return { pattern: '"$"#,##0', label: 'precio (CLP)' }
  }
  return null
}

// 1. Metadata
const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(sheetId,title))' })
const sheetIdMap = {}
for (const s of meta.data.sheets ?? []) sheetIdMap[s.properties.title] = s.properties.sheetId

const requests = []
const plan = []
const sospechosos = []

for (const hoja of HOJAS) {
  const sheetId = sheetIdMap[hoja]
  if (sheetId === undefined) { console.warn(`(skip) hoja no encontrada: ${hoja}`); continue }
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: hoja,
    valueRenderOption: 'UNFORMATTED_VALUE',
  })
  const all = res.data.values ?? []
  const headers = all[0] ?? []

  headers.forEach((h, colIdx) => {
    const fmt = detectarFormato(h)
    if (!fmt) return
    plan.push({ hoja, col: colIdx, header: h, pattern: fmt.pattern, label: fmt.label })

    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: colIdx, endColumnIndex: colIdx + 1 },
        cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: fmt.pattern } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    })

    // Sospechosos: pesos entre 0 y 1 podrían ser horas mal guardadas
    if (fmt.label === 'peso (kg)') {
      for (let r = 1; r < all.length; r++) {
        const v = all[r]?.[colIdx]
        if (v === undefined || v === null || v === '') continue
        const num = Number(v)
        if (Number.isFinite(num) && num > 0 && num < 1) {
          sospechosos.push({ hoja, fila: r + 1, col: h, valor: v, posibleHora: fraccionAHora(num) })
        }
      }
    }
  })
}

function fraccionAHora(frac) {
  const totalMin = Math.round(frac * 24 * 60)
  const h = Math.floor(totalMin / 60) % 24
  const m = totalMin % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

if (plan.length === 0) {
  console.log('No se encontraron columnas numéricas conocidas.')
  process.exit(0)
}

console.log(`Plan: aplicar formato a ${plan.length} columnas:\n`)
for (const p of plan) {
  console.log(`  ${p.hoja.padEnd(22)} col ${String(p.col + 1).padStart(2)}  ${p.header.padEnd(22)} → ${p.pattern.padEnd(12)} [${p.label}]`)
}

if (sospechosos.length > 0) {
  console.log(`\n⚠ Pesos sospechosos (valor entre 0 y 1, parecen horas mal interpretadas): ${sospechosos.length}`)
  for (const s of sospechosos) {
    console.log(`  ${s.hoja} fila ${s.fila} col '${s.col}' = ${s.valor}  (parece hora ${s.posibleHora})`)
  }
  console.log('  → Revisalos manualmente en el Sheet y reingresá el peso correcto.')
}

if (DRY) {
  console.log('\n[DRY-RUN] No se escribió nada. Quitá --dry para aplicar el formato.')
  process.exit(0)
}

console.log('\nAplicando formato...')
await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } })
console.log(`✓ Listo. ${requests.length} columnas formateadas.`)
