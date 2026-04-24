import { google, sheets_v4 } from 'googleapis'

let cachedAuth: InstanceType<typeof google.auth.JWT> | null = null
let cachedSheets: sheets_v4.Sheets | null = null

function getAuth() {
  if (cachedAuth) return cachedAuth
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
  cachedAuth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  })
  return cachedAuth
}

function getSheets() {
  if (cachedSheets) return cachedSheets
  cachedSheets = google.sheets({ version: 'v4', auth: getAuth() })
  return cachedSheets
}

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID!

function normalizeCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'string') {
    const upper = v.trim().toUpperCase()
    if (upper === 'VERDADERO' || upper === 'TRUE') return 'TRUE'
    if (upper === 'FALSO' || upper === 'FALSE') return 'FALSE'
    return v
  }
  return String(v)
}

export async function getSheetData(sheetName: string): Promise<Record<string, string>[]> {
  const sheets = getSheets()
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetName,
    valueRenderOption: 'UNFORMATTED_VALUE',
  })
  const rows = res.data.values
  if (!rows || rows.length < 2) return []
  const headers = rows[0] as string[]
  return rows.slice(1).map((row) => {
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => {
      obj[h] = normalizeCell(row[i])
    })
    return obj
  })
}

export async function appendRow(sheetName: string, data: Record<string, unknown>): Promise<void> {
  const sheets = getSheets()
  const headersRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!1:1`,
  })
  const headers = headersRes.data.values?.[0] as string[] ?? []
  const row = headers.map((h) => data[h] ?? '')
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetName,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  })
}

export async function updateRow(
  sheetName: string,
  rowIndex: number,
  data: Record<string, unknown>
): Promise<void> {
  const sheets = getSheets()
  const headersRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!1:1`,
  })
  const headers = headersRes.data.values?.[0] as string[] ?? []
  const row = headers.map((h) => data[h] ?? '')
  // rowIndex is 0-based from data rows; sheet row = rowIndex + 2 (header is row 1)
  const sheetRow = rowIndex + 2
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A${sheetRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  })
}

export async function findRows(
  sheetName: string,
  field: string,
  value: string
): Promise<Record<string, string>[]> {
  const rows = await getSheetData(sheetName)
  return rows.filter((row) => row[field] === value)
}

export async function ensureSheet(sheetName: string): Promise<void> {
  const sheets = getSheets()
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID })
  const exists = meta.data.sheets?.some(s => s.properties?.title === sheetName)
  if (exists) return
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{ addSheet: { properties: { title: sheetName } } }],
    },
  })
}

export async function ensureColumn(sheetName: string, columnName: string): Promise<void> {
  const sheets = getSheets()
  const headersRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!1:1`,
  })
  const headers = (headersRes.data.values?.[0] as string[]) ?? []
  if (headers.includes(columnName)) return
  const nextCol = String.fromCharCode(65 + headers.length)
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!${nextCol}1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[columnName]] },
  })
}

/**
 * Ensures all given columns exist as headers in row 1. Does it in a single
 * write so sequential ensureColumn calls don't each re-read headers.
 * Also auto-expands the sheet grid if the new columns would fall outside it.
 */
export async function ensureColumns(sheetName: string, columnNames: string[]): Promise<void> {
  const sheets = getSheets()
  const headersRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!1:1`,
  })
  const headers = (headersRes.data.values?.[0] as string[]) ?? []
  const missing = columnNames.filter(c => !headers.includes(c))
  if (missing.length === 0) return
  const startIdx = headers.length
  const endIdx = startIdx + missing.length - 1

  // Verificar si el grid tiene espacio; si no, expandir antes de escribir
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID })
  const sheet = meta.data.sheets?.find(s => s.properties?.title === sheetName)
  const sheetId = sheet?.properties?.sheetId
  const currentColCount = sheet?.properties?.gridProperties?.columnCount ?? 26
  if (sheetId !== undefined && endIdx >= currentColCount) {
    const extra = endIdx - currentColCount + 1
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          appendDimension: { sheetId, dimension: 'COLUMNS', length: extra },
        }],
      },
    })
  }

  const startCol = columnLetter(startIdx)
  const endCol = columnLetter(endIdx)
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!${startCol}1:${endCol}1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [missing] },
  })
}

function columnLetter(idx: number): string {
  // 0 → A, 25 → Z, 26 → AA, 27 → AB, ...
  let s = ''
  let n = idx
  while (true) {
    s = String.fromCharCode(65 + (n % 26)) + s
    if (n < 26) return s
    n = Math.floor(n / 26) - 1
  }
}

/**
 * Reordena las columnas de una hoja para que coincidan con `desiredOrder`.
 * Columnas presentes en la hoja pero NO en desiredOrder se preservan al final.
 * Usa FORMATTED_VALUE + USER_ENTERED para preservar fechas/formatos.
 * Devuelve el nuevo orden aplicado.
 */
export async function reorderColumns(sheetName: string, desiredOrder: string[]): Promise<{ applied: boolean; newOrder: string[]; rowsAffected: number }> {
  const sheets = getSheets()
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetName,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  const rows = (res.data.values ?? []) as string[][]
  if (rows.length === 0) return { applied: false, newOrder: [], rowsAffected: 0 }

  const oldHeaders = (rows[0] ?? []) as string[]
  const dataRows = rows.slice(1)

  const inSchema = desiredOrder.filter(name => oldHeaders.includes(name))
  const extras = oldHeaders.filter(name => !desiredOrder.includes(name))
  const newOrder = [...inSchema, ...extras]

  const alreadyOrdered = newOrder.length === oldHeaders.length &&
    newOrder.every((name, i) => oldHeaders[i] === name)
  if (alreadyOrdered) return { applied: false, newOrder, rowsAffected: dataRows.length }

  const headerIdx = new Map(oldHeaders.map((h, i) => [h, i]))
  const reorderedRows = [
    newOrder,
    ...dataRows.map(row => newOrder.map(name => {
      const idx = headerIdx.get(name)
      return idx !== undefined ? (row[idx] ?? '') : ''
    })),
  ]

  // Limpiar el rango actual (por si había algo fuera del nuevo ancho)
  const colsWidth = Math.max(oldHeaders.length, newOrder.length)
  const lastCol = columnLetter(colsWidth - 1)
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A1:${lastCol}${rows.length}`,
  })

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: reorderedRows },
  })

  return { applied: true, newOrder, rowsAffected: dataRows.length }
}

export async function deleteRow(sheetName: string, rowIndex: number): Promise<void> {
  const sheets = getSheets()
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID })
  const sheet = meta.data.sheets?.find(s => s.properties?.title === sheetName)
  const sheetId = sheet?.properties?.sheetId
  if (sheetId === undefined) throw new Error(`Sheet "${sheetName}" not found`)
  // rowIndex 0-based from data; sheet index = rowIndex + 1 (header is index 0)
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rowIndex + 1, endIndex: rowIndex + 2 } } }],
    },
  })
}

export async function moveRow(
  sheetName: string,
  rowIndex: number,
  direction: 'up' | 'down'
): Promise<void> {
  const sheets = getSheets()
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID })
  const sheet = meta.data.sheets?.find(s => s.properties?.title === sheetName)
  const sheetId = sheet?.properties?.sheetId
  if (sheetId === undefined) throw new Error(`Sheet "${sheetName}" not found`)

  // rowIndex 0-based from data; sheet index = rowIndex + 1 (header is index 0)
  const sourceStart = rowIndex + 1
  // destinationIndex in moveDimension is based on coords BEFORE removal
  // up: move row N to position N-1 → destIndex = N-1 (which is sourceStart - 1)
  // down: move row N to position N+1 → destIndex = N+2 (after the next row, using pre-removal coords)
  const destinationIndex = direction === 'up' ? sourceStart - 1 : sourceStart + 2

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{
        moveDimension: {
          source: { sheetId, dimension: 'ROWS', startIndex: sourceStart, endIndex: sourceStart + 1 },
          destinationIndex,
        },
      }],
    },
  })
}

export async function getNextId(sheetName: string): Promise<string> {
  const rows = await getSheetData(sheetName)
  if (rows.length === 0) return '1'
  const ids = rows.map((r) => parseInt(r.id || '0', 10)).filter((n) => !isNaN(n))
  return String(Math.max(...ids, 0) + 1)
}
