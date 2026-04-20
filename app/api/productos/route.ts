import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, appendRow, updateRow, getNextId, ensureColumn, deleteRow } from '@/lib/google-sheets'

export async function GET() {
  try {
    const rows = await getSheetData('productos')
    return NextResponse.json(rows)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureColumn('productos', 'stock')
    const body = await req.json()
    const id = await getNextId('productos')
    const now = new Date().toISOString().split('T')[0]
    const row = {
      id,
      nombre: body.nombre,
      precio: String(body.precio),
      foto_url: body.foto_url ?? '',
      stock: String(body.stock ?? 0),
      activo: 'TRUE',
      fecha_creacion: now,
    }
    await appendRow('productos', row)
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
    const rows = await getSheetData('productos')
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    await deleteRow('productos', idx)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await ensureColumn('productos', 'stock')
    const body = await req.json()
    const { id, delta_stock, ...updates } = body
    const rows = await getSheetData('productos')
    const idx = rows.findIndex((r) => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    let updated = { ...rows[idx], ...updates }
    // delta_stock: positive = add units, negative = remove
    if (delta_stock !== undefined) {
      const currentStock = parseInt(updated.stock || '0', 10)
      updated = { ...updated, stock: String(Math.max(0, currentStock + delta_stock)) }
    }
    await updateRow('productos', idx, updated)
    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}
