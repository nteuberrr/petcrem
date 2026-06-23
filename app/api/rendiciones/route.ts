import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, appendRow, updateById, getNextId, deleteById, ensureColumns, ensureSheet } from '@/lib/datastore'
import { todayISO } from '@/lib/dates'

const HOJA = 'rendiciones'
const COLS = ['id', 'usuario', 'descripcion', 'fecha', 'monto', 'tipo_documento', 'partida_id', 'estado', 'pago_id', 'fecha_creacion']
const TIPOS_DOC = ['boleta', 'factura', 'prestamo']

async function ensure() {
  await ensureSheet(HOJA)
  await ensureColumns(HOJA, COLS)
}

export async function GET() {
  try {
    await ensure()
    const rows = await getSheetData(HOJA)
    return NextResponse.json(rows.reverse())
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (!body.usuario || !body.descripcion || !body.fecha || body.monto === undefined) {
      return NextResponse.json({ error: 'usuario, descripcion, fecha y monto requeridos' }, { status: 400 })
    }
    await ensure()
    const id = await getNextId(HOJA)
    const tipoDoc = TIPOS_DOC.includes(body.tipo_documento) ? String(body.tipo_documento) : 'boleta'
    const row = {
      id,
      usuario: String(body.usuario),
      descripcion: String(body.descripcion),
      fecha: String(body.fecha),
      monto: String(body.monto),
      tipo_documento: tipoDoc,
      // Solo las boletas se asignan a una partida del EERR (factura/préstamo no).
      partida_id: tipoDoc === 'boleta' ? String(body.partida_id || '') : '',
      estado: 'pendiente',
      pago_id: '',
      fecha_creacion: todayISO(),
    }
    await appendRow(HOJA, row)
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { id, ...updates } = body
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    await ensure()
    const rows = await getSheetData(HOJA)
    const row = rows.find(r => String(r.id) === String(id))
    if (!row) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    // Factura/préstamo no llevan partida; al cambiar a esos tipos la limpiamos.
    if (updates.tipo_documento === 'factura' || updates.tipo_documento === 'prestamo') updates.partida_id = ''
    const updated = { ...row, ...updates }
    await updateById(HOJA, String(id), updated)
    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    await ensure()
    const rows = await getSheetData(HOJA)
    if (!rows.some(r => String(r.id) === String(id))) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    await deleteById(HOJA, id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
