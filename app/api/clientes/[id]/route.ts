import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, updateRow, ensureColumns, deleteRow } from '@/lib/google-sheets'
import { parseDecimal } from '@/lib/numbers'
import { calcularSnapshotFicha, type AdicionalItem as PCAdicionalItem } from '@/lib/price-calculator'

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

    let despacho = null
    if (cliente.despacho_id) {
      const despachos = await getSheetData('despachos')
      despacho = despachos.find((d) => d.id === cliente.despacho_id) ?? null
    }

    return NextResponse.json({ ...cliente, ciclo, despacho })
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
      'descuento_id', 'descuento_nombre', 'descuento_tipo', 'descuento_valor', 'descuento_monto',
      'fecha_defuncion', 'notas', 'tipo_pago', 'estado_pago',
      'peso_declarado', 'peso_ingreso', 'despacho_id',
      'precio_servicio', 'precio_adicionales', 'precio_total',
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
    // Normalizar teléfono: solo dígitos, máximo 9
    if (typeof normalizedBody.telefono === 'string') {
      normalizedBody.telefono = normalizedBody.telefono.replace(/\D/g, '').slice(-9)
    }

    const candidate = { ...rows[idx], ...normalizedBody }

    // Recalcular snapshot del precio con los valores finales (post-merge).
    // Este es el único punto donde se reescribe: edición explícita de la ficha.
    // Cambios en tablas de precio nunca alcanzan acá.
    const pesoSnapshot = parseDecimal(String(candidate.peso_ingreso ?? '')) ?? parseDecimal(String(candidate.peso_declarado ?? '')) ?? 0
    const codigoServSnap = String(candidate.codigo_servicio ?? 'CI')
    let adicionalesSnap: PCAdicionalItem[] = []
    try { adicionalesSnap = JSON.parse(String(candidate.adicionales ?? '[]')) } catch { adicionalesSnap = [] }
    const snapshot = await calcularSnapshotFicha({
      peso: pesoSnapshot,
      codigo_servicio: codigoServSnap,
      veterinaria_id: candidate.veterinaria_id ? String(candidate.veterinaria_id) : undefined,
      tipo_precios: candidate.tipo_precios ? String(candidate.tipo_precios) : undefined,
      adicionales: adicionalesSnap,
      descuento_tipo: candidate.descuento_tipo ? String(candidate.descuento_tipo) : undefined,
      descuento_valor: candidate.descuento_valor as number | string | undefined,
    })

    const updated = {
      ...candidate,
      tipo_precios: snapshot.tipo_precios_efectivo,
      precio_servicio: snapshot.precio_servicio,
      precio_adicionales: snapshot.precio_adicionales,
      precio_total: snapshot.precio_total,
      descuento_monto: String(snapshot.descuento_monto),
    }
    await updateRow('clientes', idx, updated)
    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

/**
 * Eliminar una ficha de cliente. Solo admin.
 *
 * Antes de borrar la fila, limpia las referencias cruzadas para no dejar datos huérfanos:
 *  - Devuelve al stock las unidades de productos adicionales que la ficha estaba consumiendo.
 *  - Quita el id del cliente de la lista `mascotas_ids` del ciclo asociado (si tenía uno).
 *  - Quita el id del cliente de la lista `paradas_ids` del despacho asociado (si tenía uno).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    const role = (session?.user as { role?: string })?.role
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Solo administradores pueden eliminar fichas' }, { status: 403 })
    }

    const { id } = await params
    const rows = await getSheetData('clientes')
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    const cliente = rows[idx]

    // 1) Revertir stock de productos adicionales (devolver lo que consumió esta ficha)
    const items = parseAdicionales(cliente.adicionales)
    if (items.length > 0) {
      await adjustProductStock(items, [])
    }

    // 2) Limpiar referencia en el ciclo (si tenía uno)
    if (cliente.ciclo_id) {
      try {
        const ciclos = await getSheetData('ciclos')
        const cidx = ciclos.findIndex(c => c.id === cliente.ciclo_id)
        if (cidx !== -1) {
          const ciclo = ciclos[cidx]
          const idsRaw = (ciclo.mascotas_ids ?? '').toString()
          const idsArr = idsRaw.split(',').map(s => s.trim()).filter(Boolean)
          if (idsArr.includes(id)) {
            const filtrados = idsArr.filter(x => x !== id)
            await updateRow('ciclos', cidx, { ...ciclo, mascotas_ids: filtrados.join(',') })
          }
        }
      } catch (err) {
        console.warn('[clientes/delete] no se pudo limpiar referencia en ciclo:', err)
      }
    }

    // 3) Limpiar referencia en el despacho (si tenía uno)
    if (cliente.despacho_id) {
      try {
        const despachos = await getSheetData('despachos')
        const didx = despachos.findIndex(d => d.id === cliente.despacho_id)
        if (didx !== -1) {
          const desp = despachos[didx]
          const idsRaw = (desp.paradas_ids ?? desp.mascotas_ids ?? '').toString()
          const idsArr = idsRaw.split(',').map(s => s.trim()).filter(Boolean)
          if (idsArr.includes(id)) {
            const filtrados = idsArr.filter(x => x !== id)
            const colKey = desp.paradas_ids !== undefined ? 'paradas_ids' : 'mascotas_ids'
            await updateRow('despachos', didx, { ...desp, [colKey]: filtrados.join(',') })
          }
        }
      } catch (err) {
        console.warn('[clientes/delete] no se pudo limpiar referencia en despacho:', err)
      }
    }

    // 4) Borrar la fila del cliente
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
