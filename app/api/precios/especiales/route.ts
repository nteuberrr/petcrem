import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, appendRow, updateRow, getNextId, deleteRow, ensureColumns, ensureSheet } from '@/lib/google-sheets'

const EXPECTED_COLS = ['id', 'veterinaria_id', 'peso_min', 'peso_max', 'precio_ci', 'precio_cp', 'precio_sd']

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const vetId = searchParams.get('veterinaria_id')
    await ensureSheet('precios_especiales')
    await ensureColumns('precios_especiales', EXPECTED_COLS)
    let rows = await getSheetData('precios_especiales')
    if (vetId) rows = rows.filter(r => r.veterinaria_id === vetId)
    return NextResponse.json(rows)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    await ensureSheet('precios_especiales')
    await ensureColumns('precios_especiales', EXPECTED_COLS)
    const id = await getNextId('precios_especiales')
    const row = {
      id,
      veterinaria_id: String(body.veterinaria_id),
      peso_min: String(body.peso_min),
      peso_max: String(body.peso_max),
      precio_ci: String(body.precio_ci),
      precio_cp: String(body.precio_cp),
      precio_sd: String(body.precio_sd),
    }
    await appendRow('precios_especiales', row)
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    const rows = await getSheetData('precios_especiales')
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    await deleteRow('precios_especiales', idx)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { id, ...updates } = body
    const rows = await getSheetData('precios_especiales')
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    const updated = { ...rows[idx], ...updates }
    await updateRow('precios_especiales', idx, updated)
    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}
