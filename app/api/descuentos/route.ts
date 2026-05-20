import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, appendRow, updateRow, getNextId, deleteRow } from '@/lib/google-sheets'
import { todayISO } from '@/lib/dates'

const SHEET = 'descuentos'

type Tipo = 'fijo' | 'variable'

function normalizeTipo(raw: unknown): Tipo {
  return raw === 'fijo' ? 'fijo' : 'variable'
}

function normalizeValor(tipo: Tipo, raw: unknown): number {
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '')) || 0
  if (n < 0) return 0
  if (tipo === 'variable' && n > 100) return 100
  return n
}

export async function GET() {
  try {
    const rows = await getSheetData(SHEET)
    return NextResponse.json(rows)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const nombre = String(body?.nombre ?? '').trim()
    if (!nombre) return NextResponse.json({ error: 'nombre requerido' }, { status: 400 })
    const tipo = normalizeTipo(body?.tipo)
    const valor = normalizeValor(tipo, body?.valor)

    const id = await getNextId(SHEET)
    const row = {
      id,
      nombre,
      tipo,
      valor: String(valor),
      activo: 'TRUE',
      fecha_creacion: todayISO(),
    }
    await appendRow(SHEET, row)
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
    const rows = await getSheetData(SHEET)
    const idx = rows.findIndex(r => r.id === String(id))
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    const merged: Record<string, string> = { ...rows[idx] }
    if (typeof updates.nombre === 'string') merged.nombre = updates.nombre.trim()
    if (updates.tipo !== undefined || updates.valor !== undefined) {
      const tipo = normalizeTipo(updates.tipo ?? merged.tipo)
      const valor = normalizeValor(tipo, updates.valor ?? merged.valor)
      merged.tipo = tipo
      merged.valor = String(valor)
    }
    if (updates.activo !== undefined) {
      merged.activo = updates.activo === true || updates.activo === 'TRUE' ? 'TRUE' : 'FALSE'
    }
    await updateRow(SHEET, idx, merged)
    return NextResponse.json(merged)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
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
