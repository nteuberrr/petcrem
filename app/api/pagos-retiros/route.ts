import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { google, sheets_v4 } from 'googleapis'
import { getSheetData, appendRow, getNextId, ensureColumns, ensureSheet } from '@/lib/google-sheets'
import { todayISO, formatDateForSheet } from '@/lib/dates'

export const dynamic = 'force-dynamic'

const HOJA = 'pagos_retiros'
const COLS = [
  'id', 'fecha_pago', 'usuario_id', 'usuario_nombre',
  'retiros_ids', 'cantidad', 'monto_total', 'comentarios',
  'creado_por', 'fecha_creacion',
]

const HOJA_RETIROS = 'retiros_adicionales'
const COLS_RETIROS = ['id', 'usuario_id', 'usuario_nombre', 'fecha', 'hora', 'cliente_nombre', 'comentario', 'pago_id', 'fecha_creacion']

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID!

function getAuth() {
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
}

async function ensure() {
  await ensureSheet(HOJA)
  await ensureColumns(HOJA, COLS)
  await ensureSheet(HOJA_RETIROS)
  await ensureColumns(HOJA_RETIROS, COLS_RETIROS)
}

function colLetter(idx: number): string {
  let s = ''
  let n = idx
  while (true) {
    s = String.fromCharCode(65 + (n % 26)) + s
    if (n < 26) return s
    n = Math.floor(n / 26) - 1
  }
}

/**
 * Marca masivamente un set de retiros con un pago_id (o lo limpia con '').
 * Usa una sola escritura batch en lugar de N updateRow para evitar quota.
 */
async function setPagoIdEnRetiros(sheets: sheets_v4.Sheets, retiroIds: Set<string>, pagoId: string) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: HOJA_RETIROS,
    valueRenderOption: 'UNFORMATTED_VALUE',
  })
  const matrix = (res.data.values ?? []) as unknown[][]
  if (matrix.length < 2) return 0
  const headers = (matrix[0] as string[]) ?? []
  const idIdx = headers.indexOf('id')
  const pagoIdIdx = headers.indexOf('pago_id')
  if (idIdx === -1 || pagoIdIdx === -1) return 0
  const dataRows = matrix.slice(1)
  let cambios = 0
  for (const row of dataRows) {
    const id = String(row[idIdx] ?? '')
    if (retiroIds.has(id)) {
      row[pagoIdIdx] = pagoId
      cambios += 1
    }
  }
  if (cambios > 0) {
    const lastCol = colLetter(headers.length - 1)
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${HOJA_RETIROS}!A2:${lastCol}${dataRows.length + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: dataRows as (string | number | boolean)[][] },
    })
  }
  return cambios
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user?.role !== 'admin') {
      return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
    }
    await ensure()
    const rows = await getSheetData(HOJA)
    const pagos = rows.map(r => ({
      id: r.id,
      fecha_pago: formatDateForSheet(r.fecha_pago) || r.fecha_pago,
      usuario_id: r.usuario_id,
      usuario_nombre: r.usuario_nombre,
      retiros_ids: (() => {
        try { return JSON.parse(r.retiros_ids || '[]') as string[] } catch { return [] }
      })(),
      cantidad: parseInt(r.cantidad || '0', 10) || 0,
      monto_total: parseFloat(r.monto_total) || 0,
      comentarios: r.comentarios,
      creado_por: r.creado_por,
      fecha_creacion: formatDateForSheet(r.fecha_creacion) || r.fecha_creacion,
    }))
    pagos.sort((a, b) => b.fecha_pago.localeCompare(a.fecha_pago))
    return NextResponse.json(pagos)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user?.role !== 'admin') {
      return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
    }
    const body = await req.json()
    const { fecha_pago, retiros_ids, comentarios } = body
    if (!fecha_pago || !Array.isArray(retiros_ids) || retiros_ids.length === 0) {
      return NextResponse.json({ error: 'fecha_pago y al menos 1 retiro_id son requeridos' }, { status: 400 })
    }
    await ensure()

    // Validar que los retiros existan, no estén ya pagados y obtener usuario asociado
    const retiros = await getSheetData(HOJA_RETIROS)
    const seleccionados = retiros.filter(r => retiros_ids.includes(r.id))
    if (seleccionados.length !== retiros_ids.length) {
      return NextResponse.json({ error: 'Algunos retiros no existen' }, { status: 400 })
    }
    const yaPagados = seleccionados.filter(r => r.pago_id)
    if (yaPagados.length > 0) {
      return NextResponse.json({
        error: `${yaPagados.length} retiros ya están pagados. Refrescá la página.`,
      }, { status: 409 })
    }

    // Todos deben ser del mismo operador (un pago = un chofer)
    const operadores = new Set(seleccionados.map(r => r.usuario_id))
    if (operadores.size > 1) {
      return NextResponse.json({ error: 'No se pueden mezclar retiros de distintos operadores en un mismo pago' }, { status: 400 })
    }
    const usuarioId = seleccionados[0].usuario_id
    const usuarioNombre = seleccionados[0].usuario_nombre

    // Obtener precio vigente al momento del pago
    const configs = await getSheetData('jornada_config')
    const fechaIso = formatDateForSheet(String(fecha_pago)) || String(fecha_pago)
    const elegibles = configs
      .map(c => ({
        vigente_desde: formatDateForSheet(c.vigente_desde) || c.vigente_desde,
        precio_retiro_adicional: parseFloat(c.precio_retiro_adicional || '0') || 0,
      }))
      .filter(c => c.vigente_desde && c.vigente_desde <= fechaIso)
      .sort((a, b) => b.vigente_desde.localeCompare(a.vigente_desde))
    const precio = elegibles[0]?.precio_retiro_adicional ?? 0
    const monto_total = retiros_ids.length * precio

    const id = await getNextId(HOJA)
    const row = {
      id,
      fecha_pago: fechaIso,
      usuario_id: usuarioId,
      usuario_nombre: usuarioNombre,
      retiros_ids: JSON.stringify(retiros_ids),
      cantidad: retiros_ids.length,
      monto_total,
      comentarios: comentarios ?? '',
      creado_por: session.user?.email ?? '',
      fecha_creacion: todayISO(),
    }
    await appendRow(HOJA, row)

    // Marcar retiros con pago_id
    const sheets = google.sheets({ version: 'v4', auth: getAuth() })
    await setPagoIdEnRetiros(sheets, new Set(retiros_ids), id)

    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user?.role !== 'admin') {
      return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
    }
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    await ensure()

    const rows = await getSheetData(HOJA)
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    const pago = rows[idx]
    let retirosIds: string[] = []
    try { retirosIds = JSON.parse(pago.retiros_ids || '[]') } catch { /* noop */ }

    // Limpiar pago_id de los retiros asociados
    if (retirosIds.length > 0) {
      const sheets = google.sheets({ version: 'v4', auth: getAuth() })
      await setPagoIdEnRetiros(sheets, new Set(retirosIds), '')
    }

    // Eliminar la fila del pago — usar batchUpdate por rowIndex
    const sheets = google.sheets({ version: 'v4', auth: getAuth() })
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID })
    const sheetInfo = meta.data.sheets?.find(s => s.properties?.title === HOJA)
    if (sheetInfo?.properties?.sheetId !== undefined) {
      const sheetId = sheetInfo.properties.sheetId
      const rowToDelete = idx + 1 // 0-based + 1 header row = sheet row index 0-based
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{
            deleteDimension: {
              range: { sheetId, dimension: 'ROWS', startIndex: rowToDelete, endIndex: rowToDelete + 1 },
            },
          }],
        },
      })
    }

    return NextResponse.json({ ok: true, retiros_revertidos: retirosIds.length })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
