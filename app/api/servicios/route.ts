import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, appendRow, updateRow, getNextId, deleteRow } from '@/lib/google-sheets'
import { todayISO } from '@/lib/dates'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const tipo = searchParams.get('tipo')
    if (tipo === 'otros') {
      const rows = await getSheetData('otros_servicios')
      return NextResponse.json(rows)
    }
    const rows = await getSheetData('tipos_servicio')
    return NextResponse.json(rows)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const tipo = searchParams.get('tipo')
    const body = await req.json()
    const hoja = tipo === 'otros' ? 'otros_servicios' : 'tipos_servicio'
    const id = await getNextId(hoja)
    const now = todayISO()
    const row = { id, ...body, activo: 'TRUE', fecha_creacion: now }
    await appendRow(hoja, row)
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

function findUniqueIndex(rows: Record<string, string>[], id: string, hoja: string): { idx: number; error?: string } {
  const matches: number[] = []
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].id === id) matches.push(i)
  }
  if (matches.length === 0) return { idx: -1, error: 'No encontrado' }
  if (matches.length > 1) {
    return {
      idx: -1,
      error: `Hay ${matches.length} filas con id="${id}" en ${hoja}. Andá a Configuración → Mantenimiento → Actualizar base de datos para renumerar IDs duplicados.`,
    }
  }
  return { idx: matches[0] }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const tipo = searchParams.get('tipo')
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    const hoja = tipo === 'otros' ? 'otros_servicios' : 'tipos_servicio'
    const rows = await getSheetData(hoja)
    const { idx, error } = findUniqueIndex(rows, id, hoja)
    if (error) return NextResponse.json({ error }, { status: error === 'No encontrado' ? 404 : 409 })
    await deleteRow(hoja, idx)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const tipo = searchParams.get('tipo')
    const hoja = tipo === 'otros' ? 'otros_servicios' : 'tipos_servicio'
    const body = await req.json()
    const { id, ...updates } = body
    const rows = await getSheetData(hoja)
    const { idx, error } = findUniqueIndex(rows, id, hoja)
    if (error) return NextResponse.json({ error }, { status: error === 'No encontrado' ? 404 : 409 })
    const updated = { ...rows[idx], ...updates }
    await updateRow(hoja, idx, updated)
    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}
