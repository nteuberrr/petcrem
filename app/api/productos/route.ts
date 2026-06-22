import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, appendRow, updateById, getNextId, ensureColumns, deleteRow } from '@/lib/datastore'
import { todayISO } from '@/lib/dates'
import { ajustarStock } from '@/lib/stock'

export async function GET() {
  try {
    await ensureColumns('productos', ['stock', 'categoria'])
    const rows = await getSheetData('productos')
    return NextResponse.json(rows)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureColumns('productos', ['stock', 'categoria'])
    const body = await req.json()
    const id = await getNextId('productos')
    const now = todayISO()
    const row = {
      id,
      nombre: body.nombre,
      precio: String(body.precio),
      foto_url: body.foto_url ?? '',
      stock: String(body.stock ?? 0),
      categoria: (body.categoria ?? '').toString().trim(),
      activo: 'TRUE',
      fecha_creacion: now,
    }
    await appendRow('productos', row)
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

function findUniqueIndex(rows: Record<string, string>[], id: string): { idx: number; error?: string } {
  const matches: number[] = []
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].id === id) matches.push(i)
  }
  if (matches.length === 0) return { idx: -1, error: 'No encontrado' }
  if (matches.length > 1) {
    return {
      idx: -1,
      error: `Hay ${matches.length} productos con id="${id}" en la planilla. Ve a Configuración → Mantenimiento → Actualizar base de datos para renumerar IDs duplicados.`,
    }
  }
  return { idx: matches[0] }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    const rows = await getSheetData('productos')
    const { idx, error } = findUniqueIndex(rows, id)
    if (error) return NextResponse.json({ error }, { status: idx === -1 && error === 'No encontrado' ? 404 : 409 })
    await deleteRow('productos', idx)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await ensureColumns('productos', ['stock', 'categoria'])
    const body = await req.json()
    const { id, delta_stock, ...updates } = body
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    const rows = await getSheetData('productos')
    const { idx, error } = findUniqueIndex(rows, String(id))
    if (error) return NextResponse.json({ error }, { status: idx === -1 && error === 'No encontrado' ? 404 : 409 })

    // Campos sueltos (nombre/precio/categoría/stock absoluto): replace por id.
    let updated = { ...rows[idx], ...updates }
    if (Object.keys(updates).length > 0) {
      await updateById('productos', String(id), updated)
    }

    // Ajuste RELATIVO de stock: atómico (compare-and-set con reintento), para no
    // perder unidades cuando dos ajustes tocan el mismo producto a la vez.
    if (delta_stock !== undefined && Number(delta_stock) !== 0) {
      const nuevo = await ajustarStock(String(id), Number(delta_stock))
      if (nuevo === null) {
        return NextResponse.json({ error: 'No se pudo ajustar el stock (producto inexistente o demasiada concurrencia). Reintenta.' }, { status: 409 })
      }
      updated = { ...updated, stock: String(nuevo) }
    }

    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}
