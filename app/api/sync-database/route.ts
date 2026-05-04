import { NextResponse } from 'next/server'
import { google, sheets_v4 } from 'googleapis'
import { ensureColumns, ensureSheet } from '@/lib/google-sheets'
import { parseMonto, parsePeso, parseDecimalOr0 } from '@/lib/numbers'
import { formatDateForSheet } from '@/lib/dates'

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

/**
 * Reasigna `numero_recorrido` (correlativo por día) y `numero_global`
 * (correlativo total) en la hoja `despachos`. Corrige los datos viejos
 * que tenían todos los recorridos con número 1.
 *
 * - numero_recorrido: 1, 2, 3... reiniciando por cada día
 * - numero_global: 1, 2, 3... sin reiniciar nunca (orden de creación = id asc)
 */
async function syncDespachosNumeros(sheets: sheets_v4.Sheets) {
  await ensureSheet('despachos')
  await ensureColumns('despachos', ['id', 'fecha', 'numero_recorrido', 'numero_global', 'mascotas_ids', 'nota', 'fecha_creacion'])
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'despachos',
    valueRenderOption: 'UNFORMATTED_VALUE',
  })
  const matrix = (res.data.values ?? []) as unknown[][]
  if (matrix.length < 2) return { total_filas: 0, filas_actualizadas: 0, cambios: [] as NumberCambio[] }

  const headers = (matrix[0] as string[]) ?? []
  const idxOf = new Map(headers.map((h, i) => [h, i]))
  const dataRows = matrix.slice(1)

  const idIdx = idxOf.get('id')
  const fechaIdx = idxOf.get('fecha')
  const numeroIdx = idxOf.get('numero_recorrido')
  const globalIdx = idxOf.get('numero_global')
  if (idIdx === undefined || fechaIdx === undefined || numeroIdx === undefined || globalIdx === undefined) {
    return { total_filas: dataRows.length, filas_actualizadas: 0, cambios: [] as NumberCambio[] }
  }

  // Pre-calcular id e iso por fila (mantenemos referencia a la fila para escribir in-place)
  const annotated = dataRows.map((row) => {
    const rawFecha = row[fechaIdx]
    const fechaIso = formatDateForSheet(String(rawFecha ?? '')) || String(rawFecha ?? '')
    const id = parseInt(String(row[idIdx] ?? '0'), 10) || 0
    return { row, id, fechaIso }
  })

  // numero_global: ordenar por id ascendente, asignar 1, 2, 3...
  const ordenadosGlobal = [...annotated].sort((a, b) => a.id - b.id)
  const globalByRow = new Map<unknown[], number>()
  ordenadosGlobal.forEach((entry, i) => globalByRow.set(entry.row, i + 1))

  // numero_recorrido: agrupar por fecha, asignar 1, 2, 3... dentro de cada bucket (orden id asc)
  const buckets = new Map<string, typeof annotated>()
  for (const entry of annotated) {
    const arr = buckets.get(entry.fechaIso) ?? []
    arr.push(entry)
    buckets.set(entry.fechaIso, arr)
  }
  const recorridoByRow = new Map<unknown[], number>()
  for (const arr of buckets.values()) {
    arr.sort((a, b) => a.id - b.id)
    arr.forEach((entry, i) => recorridoByRow.set(entry.row, i + 1))
  }

  const cambios: NumberCambio[] = []
  for (const entry of annotated) {
    const camposCambiados: string[] = []
    const expectedRecorrido = recorridoByRow.get(entry.row) ?? 1
    const actualRecorrido = parseInt(String(entry.row[numeroIdx] ?? '0'), 10) || 0
    if (actualRecorrido !== expectedRecorrido) {
      entry.row[numeroIdx] = expectedRecorrido
      camposCambiados.push('numero_recorrido')
    }
    const expectedGlobal = globalByRow.get(entry.row) ?? 0
    const actualGlobal = parseInt(String(entry.row[globalIdx] ?? '0'), 10) || 0
    if (actualGlobal !== expectedGlobal) {
      entry.row[globalIdx] = expectedGlobal
      camposCambiados.push('numero_global')
    }
    if (camposCambiados.length > 0) {
      cambios.push({
        id: String(entry.row[idIdx] ?? ''),
        fecha: entry.fechaIso,
        campos: camposCambiados,
      })
    }
  }

  if (cambios.length > 0) {
    const lastCol = colLetter(headers.length - 1)
    const writeRange = `despachos!A2:${lastCol}${dataRows.length + 1}`
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: writeRange,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: dataRows as (string | number | boolean)[][] },
    })
  }

  return { total_filas: dataRows.length, filas_actualizadas: cambios.length, cambios }
}

/**
 * Recalcula peso_total, lt_kg y lt_mascota para todos los ciclos.
 * - peso_total: suma de pesos de las mascotas del ciclo (peso_ingreso || peso_declarado, normalizado por parsePeso)
 * - lt_kg: consumo del ciclo / peso_total
 * - lt_mascota: consumo del ciclo / cantidad de mascotas
 */
async function syncCiclosCalculados(sheets: sheets_v4.Sheets) {
  await ensureSheet('ciclos')
  await ensureColumns('ciclos', ['peso_total', 'lt_kg', 'lt_mascota'])

  // Leer ciclos y clientes en paralelo
  const [ciclosRes, clientesRes] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'ciclos',
      valueRenderOption: 'UNFORMATTED_VALUE',
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'clientes',
      valueRenderOption: 'UNFORMATTED_VALUE',
    }),
  ])

  const ciclosMatrix = (ciclosRes.data.values ?? []) as unknown[][]
  if (ciclosMatrix.length < 2) return { total_filas: 0, filas_actualizadas: 0, cambios: [] as NumberCambio[] }

  const ciclosHeaders = (ciclosMatrix[0] as string[]) ?? []
  const ciclosIdx = new Map(ciclosHeaders.map((h, i) => [h, i]))
  const ciclosRows = ciclosMatrix.slice(1)

  const fechaIdx = ciclosIdx.get('fecha')
  const idIdx = ciclosIdx.get('id')
  const litIniIdx = ciclosIdx.get('litros_inicio')
  const litFinIdx = ciclosIdx.get('litros_fin')
  const mascotasIdsIdx = ciclosIdx.get('mascotas_ids')
  const pesoTotalIdx = ciclosIdx.get('peso_total')
  const ltKgIdx = ciclosIdx.get('lt_kg')
  const ltMascotaIdx = ciclosIdx.get('lt_mascota')
  if (idIdx === undefined || litIniIdx === undefined || litFinIdx === undefined ||
      mascotasIdsIdx === undefined || pesoTotalIdx === undefined ||
      ltKgIdx === undefined || ltMascotaIdx === undefined) {
    return { total_filas: ciclosRows.length, filas_actualizadas: 0, cambios: [] as NumberCambio[] }
  }

  // Indexar clientes por id para lookup de pesos
  const clientesMatrix = (clientesRes.data.values ?? []) as unknown[][]
  const clientesHeaders = (clientesMatrix[0] as string[]) ?? []
  const cIdx = new Map(clientesHeaders.map((h, i) => [h, i]))
  const cIdIdx = cIdx.get('id')
  const cPesoIngresoIdx = cIdx.get('peso_ingreso')
  const cPesoDeclaradoIdx = cIdx.get('peso_declarado')
  const pesosByClienteId = new Map<string, number>()
  if (cIdIdx !== undefined && (cPesoIngresoIdx !== undefined || cPesoDeclaradoIdx !== undefined)) {
    for (const row of clientesMatrix.slice(1)) {
      const cid = String(row[cIdIdx] ?? '')
      if (!cid) continue
      const pi = cPesoIngresoIdx !== undefined ? row[cPesoIngresoIdx] : ''
      const pd = cPesoDeclaradoIdx !== undefined ? row[cPesoDeclaradoIdx] : ''
      const peso = parsePeso(pi) || parsePeso(pd)
      pesosByClienteId.set(cid, peso)
    }
  }

  const cambios: NumberCambio[] = []
  for (const row of ciclosRows) {
    const camposCambiados: string[] = []
    const consumo = Math.abs(parseDecimalOr0(row[litFinIdx]) - parseDecimalOr0(row[litIniIdx]))
    let mascotasIds: string[] = []
    try { mascotasIds = JSON.parse(String(row[mascotasIdsIdx] ?? '[]')) } catch { mascotasIds = [] }

    let pesoTotal = 0
    for (const mid of mascotasIds) {
      pesoTotal += pesosByClienteId.get(String(mid)) ?? 0
    }
    const ltKg = pesoTotal > 0 ? consumo / pesoTotal : 0
    const ltMascota = mascotasIds.length > 0 ? consumo / mascotasIds.length : 0

    // Comparar con valor actual y escribir si cambia (con tolerancia para evitar ruido por floats)
    const equiv = (a: number, b: number) => Math.abs(a - b) < 0.001
    const actualPeso = parseDecimalOr0(row[pesoTotalIdx])
    const actualLtKg = parseDecimalOr0(row[ltKgIdx])
    const actualLtMascota = parseDecimalOr0(row[ltMascotaIdx])

    if (!equiv(actualPeso, pesoTotal)) {
      row[pesoTotalIdx] = pesoTotal
      camposCambiados.push('peso_total')
    }
    if (!equiv(actualLtKg, ltKg)) {
      row[ltKgIdx] = ltKg
      camposCambiados.push('lt_kg')
    }
    if (!equiv(actualLtMascota, ltMascota)) {
      row[ltMascotaIdx] = ltMascota
      camposCambiados.push('lt_mascota')
    }

    if (camposCambiados.length > 0) {
      const fechaIso = fechaIdx !== undefined
        ? (formatDateForSheet(String(row[fechaIdx] ?? '')) || String(row[fechaIdx] ?? ''))
        : ''
      cambios.push({
        id: String(row[idIdx] ?? ''),
        fecha: fechaIso,
        campos: camposCambiados,
      })
    }
  }

  if (cambios.length > 0) {
    const lastCol = colLetter(ciclosHeaders.length - 1)
    const writeRange = `ciclos!A2:${lastCol}${ciclosRows.length + 1}`
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: writeRange,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: ciclosRows as (string | number | boolean)[][] },
    })
  }

  return { total_filas: ciclosRows.length, filas_actualizadas: cambios.length, cambios }
}

/**
 * Detecta IDs duplicados en una hoja y le da nuevos IDs únicos a los duplicados
 * (preserva el primer registro con cada id, renumera los siguientes con max+1).
 *
 * Esto resuelve el bug donde editar/eliminar un registro cambia accidentalmente
 * a otro distinto (porque findIndex(r => r.id === X) encuentra el primero).
 */
async function syncIdsUnicos(sheets: sheets_v4.Sheets, sheetName: string) {
  await ensureSheet(sheetName)
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetName,
    valueRenderOption: 'UNFORMATTED_VALUE',
  })
  const matrix = (res.data.values ?? []) as unknown[][]
  if (matrix.length < 2) return { total_filas: 0, filas_actualizadas: 0, cambios: [] as NumberCambio[] }

  const headers = (matrix[0] as string[]) ?? []
  const idIdx = headers.indexOf('id')
  if (idIdx === -1) return { total_filas: matrix.length - 1, filas_actualizadas: 0, cambios: [] as NumberCambio[] }
  const dataRows = matrix.slice(1)

  const ids = dataRows.map(r => parseInt(String(r[idIdx] ?? '0'), 10) || 0)
  let maxId = ids.reduce((m, n) => Math.max(m, n), 0)
  const visto = new Set<number>()
  const cambios: NumberCambio[] = []

  for (let i = 0; i < dataRows.length; i++) {
    const id = ids[i]
    if (id > 0 && !visto.has(id)) {
      visto.add(id)
      continue
    }
    // Duplicado o id 0/inválido → asignar nuevo id
    maxId += 1
    dataRows[i][idIdx] = maxId
    visto.add(maxId)
    cambios.push({
      id: String(maxId),
      fecha: '',
      campos: [`id: ${id || 'vacío'} → ${maxId}`],
    })
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
    const despachos = await syncDespachosNumeros(sheets)
    // Renumerar IDs duplicados ANTES de calcular ciclos (que lee clientes por id)
    const productosIds = await syncIdsUnicos(sheets, 'productos')
    const otrosServiciosIds = await syncIdsUnicos(sheets, 'otros_servicios')
    // Importante: ciclos depende de clientes (lee pesos), corre después del syncClientes que normaliza pesos
    const ciclos = await syncCiclosCalculados(sheets)

    return NextResponse.json({
      ok: true,
      clientes, vehiculo, petroleo, despachos, ciclos,
      productos_ids: productosIds,
      otros_servicios_ids: otrosServiciosIds,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function GET() {
  return POST()
}
