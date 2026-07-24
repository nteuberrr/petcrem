import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, appendRow, updateRow, deleteRow, getNextId, ensureSheet, ensureColumns } from '@/lib/datastore'
import { sesionConAcceso } from '@/lib/permisos-server'
import { getConsultaEutanasia } from '@/lib/eutanasia-precios'

const SHEET = 'precios_eutanasia'
const COLS = ['id', 'peso_min', 'peso_max', 'precio']

async function requireAdmin() {
  const { ok } = await sesionConAcceso('/api/eutanasias')
  if (!ok) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  return null
}

/**
 * GET — público (sin auth) para que el landing del convenio muestre la tabla.
 * Devuelve { tramos, consulta_vet }: los tramos (pago al vet si SE REALIZA) y el
 * pago al vet por la consulta cuando al evaluar NO corresponde realizarla.
 */
export async function GET() {
  try {
    await ensureSheet(SHEET)
    await ensureColumns(SHEET, COLS)
    const [rows, consulta] = await Promise.all([getSheetData(SHEET), getConsultaEutanasia()])
    rows.sort((a, b) => (parseFloat(a.peso_min) || 0) - (parseFloat(b.peso_min) || 0))
    return NextResponse.json({ tramos: rows, consulta_vet: consulta.vet })
  } catch (e) {
    console.error('[eutanasias/precios GET]', e)
    return NextResponse.json({ error: 'No se pudieron cargar los precios. Intenta nuevamente.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const body = await req.json()
    const id = await getNextId(SHEET)
    const row = {
      id,
      peso_min: String(body.peso_min ?? ''),
      peso_max: String(body.peso_max ?? ''),
      precio: String(body.precio ?? ''),
    }
    await appendRow(SHEET, row)
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const body = await req.json()
    const { id, ...updates } = body
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    const rows = await getSheetData(SHEET)
    const idx = rows.findIndex(r => r.id === String(id))
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    const updated = { ...rows[idx], ...updates }
    await updateRow(SHEET, idx, updated)
    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    const rows = await getSheetData(SHEET)
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    await deleteRow(SHEET, idx)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
