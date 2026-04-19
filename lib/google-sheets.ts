import { google } from 'googleapis'

function getAuth() {
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  })
}

function getSheets() {
  return google.sheets({ version: 'v4', auth: getAuth() })
}

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID!

export async function getSheetData(sheetName: string): Promise<Record<string, string>[]> {
  const sheets = getSheets()
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetName,
  })
  const rows = res.data.values
  if (!rows || rows.length < 2) return []
  const headers = rows[0] as string[]
  return rows.slice(1).map((row) => {
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => {
      obj[h] = (row[i] as string) ?? ''
    })
    return obj
  })
}

export async function appendRow(sheetName: string, data: Record<string, unknown>): Promise<void> {
  const sheets = getSheets()
  const existing = await getSheetData(sheetName)
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
  void existing
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

export async function getNextId(sheetName: string): Promise<string> {
  const rows = await getSheetData(sheetName)
  if (rows.length === 0) return '1'
  const ids = rows.map((r) => parseInt(r.id || '0', 10)).filter((n) => !isNaN(n))
  return String(Math.max(...ids, 0) + 1)
}
