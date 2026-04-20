import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'

function getAuth() {
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
}

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID!

async function normalizarHoja(hoja: string): Promise<{ hoja: string; total: number }> {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() })
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: hoja,
  })
  const rows = res.data.values
  if (!rows || rows.length < 2) return { hoja, total: 0 }

  const dataRowCount = rows.length - 1
  const newIds = Array.from({ length: dataRowCount }, (_, i) => [String(i + 1)])

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${hoja}!A2:A${dataRowCount + 1}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: newIds },
  })

  return { hoja, total: dataRowCount }
}

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const tipo = searchParams.get('tipo')

    const hojas = tipo === 'general' ? ['precios_generales']
      : tipo === 'convenio' ? ['precios_convenio']
      : tipo === 'especial' ? ['precios_especiales']
      : ['precios_generales', 'precios_convenio', 'precios_especiales']

    const resultados = []
    for (const h of hojas) {
      resultados.push(await normalizarHoja(h))
    }
    return NextResponse.json({ ok: true, resultados })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
