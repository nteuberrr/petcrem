import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, updateRow, ensureColumn, deleteRow } from '@/lib/google-sheets'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const rows = await getSheetData('clientes')
    const idx = rows.findIndex((r) => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    const cliente = rows[idx]

    let ciclo = null
    if (cliente.ciclo_id) {
      const ciclos = await getSheetData('ciclos')
      ciclo = ciclos.find((c) => c.id === cliente.ciclo_id) ?? null
    }

    return NextResponse.json({ ...cliente, ciclo })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json()

    await Promise.all([
      ensureColumn('clientes', 'veterinaria_id'),
      ensureColumn('clientes', 'adicionales'),
      ensureColumn('clientes', 'tipo_precios'),
      ensureColumn('clientes', 'fecha_defuncion'),
      ensureColumn('clientes', 'notas'),
      ensureColumn('clientes', 'tipo_pago'),
      ensureColumn('clientes', 'estado_pago'),
    ])

    const rows = await getSheetData('clientes')
    const idx = rows.findIndex((r) => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    // Adjust product stock when adicionales change
    if (body.adicionales !== undefined) {
      const oldAdicionales = parseAdicionales(rows[idx].adicionales)
      const newAdicionales = parseAdicionales(body.adicionales)
      await adjustProductStock(oldAdicionales, newAdicionales)
    }

    const updated = { ...rows[idx], ...body }
    await updateRow('clientes', idx, updated)
    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const rows = await getSheetData('clientes')
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    await deleteRow('clientes', idx)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

type AdicionalItem = { tipo: string; id: string; qty?: number }

function parseAdicionales(raw: string | undefined): AdicionalItem[] {
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
}

async function adjustProductStock(
  oldItems: AdicionalItem[],
  newItems: AdicionalItem[]
) {
  const productos = await getSheetData('productos')
  const productoRows = productos

  // Build qty maps for products only
  const oldQty: Record<string, number> = {}
  const newQty: Record<string, number> = {}
  oldItems.filter(a => a.tipo === 'producto').forEach(a => { oldQty[a.id] = (oldQty[a.id] || 0) + (a.qty ?? 1) })
  newItems.filter(a => a.tipo === 'producto').forEach(a => { newQty[a.id] = (newQty[a.id] || 0) + (a.qty ?? 1) })

  const allIds = new Set([...Object.keys(oldQty), ...Object.keys(newQty)])
  for (const pid of allIds) {
    const delta = (oldQty[pid] || 0) - (newQty[pid] || 0) // positive = freed, negative = consumed
    if (delta === 0) continue
    const pidx = productoRows.findIndex(p => p.id === pid)
    if (pidx === -1) continue
    const currentStock = parseInt(productoRows[pidx].stock || '0', 10)
    const newStock = Math.max(0, currentStock + delta)
    productoRows[pidx] = { ...productoRows[pidx], stock: String(newStock) }
    await updateRow('productos', pidx, productoRows[pidx])
  }
}
