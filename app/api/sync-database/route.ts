import { NextResponse } from 'next/server'
import { google, sheets_v4 } from 'googleapis'
import { ensureColumns, ensureSheet } from '@/lib/google-sheets'
import { parseMonto } from '@/lib/numbers'

/**
 * Normaliza las hojas `clientes`, `vehiculo_cargas` y `cargas_petroleo`.
 * Bulk: 1 lectura + 1 escritura por hoja. Evita el 429 de quota de Sheets API.
 *
 * Reglas clientes:
 * - estado vacío            → 'pendiente'
 * - estado_pago vacío       → 'pendiente'
 * - misma_direccion vacío   → 'FALSE'
 * - adicionales vacío       → '[]'
 * - codigo_servicio vacío   → 'CI'
 * - tipo_servicio vacío     → 'Cremación Individual'
 *
 * Reglas vehiculo_cargas y cargas_petroleo:
 * - Campos numéricos guardados como string ("15.5") → number (15.5),
 *   para que Sheets los muestre con decimal locale es-CL ("15,5").
 */

function getAuth() {
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
}

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID!

function colLetter(idx: number): string {
  let s = ''
  let n = idx
  while (true) {
    s = String.fromCharCode(65 + (n % 26)) + s
    if (n < 26) return s
    n = Math.floor(n / 26) - 1
  }
}

function normalizeBool(v: unknown): string {
  if (v === true) return 'TRUE'
  if (v === false) return 'FALSE'
  if (typeof v === 'string') {
    const u = v.trim().toUpperCase()
    if (u === 'VERDADERO' || u === 'TRUE') return 'TRUE'
    if (u === 'FALSO' || u === 'FALSE') return 'FALSE'
    return v
  }
  return String(v ?? '')
}

/**
 * Parsea un string a número, aceptando coma o punto como separador decimal.
 * - "12,5" → 12.5
 * - "1.234,56" → 1234.56  (formato europeo: punto miles, coma decimal)
 * - "12.5"   → 12.5       (formato US: punto decimal)
 * - "1234"   → 1234
 * Devuelve null si no es parseable.
 */
function parseDecimal(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  const tienePunto = s.includes('.')
  const tieneComa = s.includes(',')
  let normalized: string
  if (tienePunto && tieneComa) {
    normalized = s.replace(/\./g, '').replace(',', '.')
  } else if (tieneComa) {
    normalized = s.replace(',', '.')
  } else {
    normalized = s
  }
  const n = parseFloat(normalized)
  return Number.isFinite(n) ? n : null
}

type ClienteCambio = { id: string; codigo: string; nombre_mascota: string; campos: string[] }
type ClienteWarning = { id: string; codigo: string; nombre_mascota: string; aviso: string }
type NumberCambio = { id: string; fecha: string; campos: string[] }

async function syncClientes(sheets: sheets_v4.Sheets) {
  await ensureSheet('clientes')
  await ensureColumns('clientes', [
    'email', 'telefono',
    'veterinaria_id', 'adicionales', 'tipo_precios',
    'peso_declarado', 'peso_ingreso', 'despacho_id',
    'fecha_defuncion', 'notas', 'tipo_pago', 'estado_pago',
    'estado', 'misma_direccion', 'codigo_servicio', 'tipo_servicio',
  ])

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'clientes',
    valueRenderOption: 'UNFORMATTED_VALUE',
  })
  const matrix = (res.data.values ?? []) as unknown[][]
  if (matrix.length === 0) return { total_filas: 0, filas_actualizadas: 0, cambios: [], warnings: [] }

  const headers = (matrix[0] as string[]) ?? []
  const idxOf = new Map(headers.map((h, i) => [h, i]))
  const dataRows = matrix.slice(1)

  const get = (row: unknown[], name: string): string => {
    const i = idxOf.get(name)
    if (i === undefined) return ''
    const v = row[i]
    if (v === null || v === undefined) return ''
    return typeof v === 'string' ? v : String(v)
  }
  const set = (row: unknown[], name: string, value: string) => {
    const i = idxOf.get(name)
    if (i !== undefined) row[i] = value
  }

  const cambios: ClienteCambio[] = []
  const warnings: ClienteWarning[] = []

  for (const row of dataRows) {
    const camposCambiados: string[] = []
    const id = get(row, 'id')
    const codigo = get(row, 'codigo')
    const nombre_mascota = get(row, 'nombre_mascota')

    const estado = get(row, 'estado')
    const estado_pago = get(row, 'estado_pago')
    const misma_direccion = get(row, 'misma_direccion')
    const adicionales = get(row, 'adicionales')
    const codigo_servicio = get(row, 'codigo_servicio')
    const tipo_servicio = get(row, 'tipo_servicio')
    const ciclo_id = get(row, 'ciclo_id')
    const despacho_id = get(row, 'despacho_id')

    if (!estado) { set(row, 'estado', 'pendiente'); camposCambiados.push('estado') }
    if (!estado_pago) { set(row, 'estado_pago', 'pendiente'); camposCambiados.push('estado_pago') }
    if (!misma_direccion) { set(row, 'misma_direccion', 'FALSE'); camposCambiados.push('misma_direccion') }
    else { set(row, 'misma_direccion', normalizeBool(misma_direccion)) }
    if (!adicionales) { set(row, 'adicionales', '[]'); camposCambiados.push('adicionales') }
    if (!codigo_servicio) { set(row, 'codigo_servicio', 'CI'); camposCambiados.push('codigo_servicio') }
    if (!tipo_servicio) { set(row, 'tipo_servicio', 'Cremación Individual'); camposCambiados.push('tipo_servicio') }

    // Normalizar pesos: si están como string con punto/coma decimal → number.
    // Además, corregir escalamiento heredado de Sheets es-CL: si un peso es
    // > 150 kg (imposible para mascota), se asume mal escalado y se reduce.
    for (const campoNum of ['peso_declarado', 'peso_ingreso']) {
      const i = idxOf.get(campoNum)
      if (i === undefined) continue
      const v = row[i]
      let parsed: number | null = null
      if (typeof v === 'string' && v.trim() !== '') {
        parsed = parseDecimal(v)
      } else if (typeof v === 'number' && Number.isFinite(v)) {
        parsed = v
      }
      if (parsed !== null && parsed > 0) {
        // Aplicar normalización de escalamiento (>150 kg → dividir)
        let normalized = parsed
        if (normalized > 150) normalized = normalized / 10
        if (normalized > 150) normalized = normalized / 10
        if (normalized > 150) normalized = normalized / 10
        if (normalized > 150) normalized = normalized / 10
        if (normalized !== v) {
          row[i] = normalized
          camposCambiados.push(campoNum)
        }
      }
    }

    const estadoFinal = get(row, 'estado')
    if (estadoFinal === 'cremado' && !ciclo_id) {
      warnings.push({ id, codigo, nombre_mascota, aviso: 'estado cremado pero sin ciclo_id' })
    }
    if (estadoFinal === 'despachado' && !despacho_id) {
      warnings.push({ id, codigo, nombre_mascota, aviso: 'estado despachado pero sin despacho_id' })
    }

    if (camposCambiados.length > 0) {
      cambios.push({ id, codigo, nombre_mascota, campos: camposCambiados })
    }
  }

  if (cambios.length > 0) {
    const lastCol = colLetter(headers.length - 1)
    const writeRange = `clientes!A2:${lastCol}${dataRows.length + 1}`
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: writeRange,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: dataRows as (string | number | boolean)[][] },
    })
  }

  return { total_filas: dataRows.length, filas_actualizadas: cambios.length, cambios, warnings }
}

/**
 * Normaliza una hoja con campos numéricos.
 * - Para columnas pasadas en `numericCols`: parseDecimal estricto (12,5 → 12.5).
 * - Para columnas pasadas en `montoCols`: parseMonto (120.500 → 120500, formato CLP).
 *   Además detecta valores < 1000 con decimales (escalamiento mal) y los corrige.
 */
async function syncNumericSheet(
  sheets: sheets_v4.Sheets,
  sheetName: string,
  numericCols: string[],
  montoCols: string[] = [],
) {
  await ensureSheet(sheetName)
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetName,
    valueRenderOption: 'UNFORMATTED_VALUE',
  })
  const matrix = (res.data.values ?? []) as unknown[][]
  if (matrix.length === 0) return { total_filas: 0, filas_actualizadas: 0, cambios: [] }

  const headers = (matrix[0] as string[]) ?? []
  const idxOf = new Map(headers.map((h, i) => [h, i]))
  const dataRows = matrix.slice(1)

  const cambios: NumberCambio[] = []

  for (const row of dataRows) {
    const camposCambiados: string[] = []
    for (const col of numericCols) {
      const i = idxOf.get(col)
      if (i === undefined) continue
      const v = row[i]
      // Solo arreglo strings que representan números (acepta coma decimal)
      if (typeof v === 'string' && v.trim() !== '') {
        const n = parseDecimal(v)
        if (n !== null) {
          row[i] = n
          camposCambiados.push(col)
        }
      }
    }
    // Columnas tipo monto CLP: punto/coma = separador de miles
    for (const col of montoCols) {
      const i = idxOf.get(col)
      if (i === undefined) continue
      const v = row[i]
      let parsed: number | null = null
      if (typeof v === 'string' && v.trim() !== '') {
        parsed = parseMonto(v)
      } else if (typeof v === 'number' && Number.isFinite(v)) {
        // Si viene como número decimal pequeño, casi seguro fue mal escalado por Sheets es-CL
        if (v > 0 && v < 1000 && v % 1 !== 0) {
          let scaled = v
          while (scaled < 1000) scaled *= 1000
          parsed = Math.round(scaled / 1000) * 1000
        } else {
          parsed = v
        }
      }
      if (parsed !== null && parsed !== v) {
        row[i] = parsed
        camposCambiados.push(col)
      }
    }
    if (camposCambiados.length > 0) {
      const id = String(row[idxOf.get('id') ?? 0] ?? '')
      const fechaIdx = idxOf.get('fecha')
      const fecha = fechaIdx !== undefined ? String(row[fechaIdx] ?? '') : ''
      cambios.push({ id, fecha, campos: camposCambiados })
    }
  }

  if (cambios.length > 0) {
    const lastCol = colLetter(headers.length - 1)
    const writeRange = `${sheetName}!A2:${lastCol}${dataRows.length + 1}`
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: writeRange,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: dataRows as (string | number | boolean)[][] },
    })
  }

  return { total_filas: dataRows.length, filas_actualizadas: cambios.length, cambios }
}

export async function POST() {
  try {
    const sheets = google.sheets({ version: 'v4', auth: getAuth() })

    const clientes = await syncClientes(sheets)
    const vehiculo = await syncNumericSheet(sheets, 'vehiculo_cargas', ['litros', 'km_odometro'], ['monto'])
    const petroleo = await syncNumericSheet(sheets, 'cargas_petroleo', ['litros'], ['precio_neto', 'iva', 'especifico', 'total_bruto'])

    return NextResponse.json({ ok: true, clientes, vehiculo, petroleo })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function GET() {
  return POST()
}
