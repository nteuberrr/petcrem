import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, updateRow, ensureColumns, deleteRow } from '@/lib/google-sheets'
import { parseDecimal } from '@/lib/numbers'

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

    await ensureColumns('clientes', [
      'veterinaria_id', 'adicionales', 'tipo_precios',
      'fecha_defuncion', 'notas', 'tipo_pago', 'estado_pago',
      'peso_declarado', 'peso_ingreso', 'despacho_id',
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

    // Normalizar pesos: aceptar coma decimal y guardar como number
    const normalizedBody = { ...body }
    for (const k of ['peso_declarado', 'peso_ingreso']) {
      if (normalizedBody[k] !== undefined && normalizedBody[k] !== '') {
        const n = parseDecimal(normalizedBody[k])
        if (n !== null) normalizedBody[k] = n
      }
    }

    const updated = { ...rows[idx], ...normalizedBody }
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
  const idxById = new Map(productoRows.map((p, i) => [p.id, i]))
  await Promise.all(
    Array.from(allIds).map((pid) => {
      const delta = (oldQty[pid] || 0) - (newQty[pid] || 0) // positive = freed, negative = consumed
      if (delta === 0) return Promise.resolve()
      const pidx = idxById.get(pid)
      if (pidx === undefined) return Promise.resolve()
      const currentStock = parseInt(productoRows[pidx].stock || '0', 10)
      const newStock = Math.max(0, currentStock + delta)
      productoRows[pidx] = { ...productoRows[pidx], stock: String(newStock) }
      return updateRow('productos', pidx, productoRows[pidx])
    })
  )
}
