import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, updateById, ensureColumns, deleteRow } from '@/lib/datastore'
import { ajustarStock } from '@/lib/stock'
import { parseDecimal } from '@/lib/numbers'
import { calcularSnapshotFicha, type AdicionalItem as PCAdicionalItem } from '@/lib/price-calculator'
import { generarCodigo } from '@/lib/codigo-generator'
import { enviarRegistroMascota } from '@/lib/cliente-mailer'
import { capitalizarNombre } from '@/lib/nombres'
import { esAdmin } from '@/lib/roles'

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
    // Nombres en Tipo Título (se usan tal cual en correos/certificados).
    for (const k of ['nombre_mascota', 'nombre_tutor']) {
      if (typeof normalizedBody[k] === 'string') normalizedBody[k] = capitalizarNombre(normalizedBody[k])
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

    // "Registrar" un borrador: cuando la ficha aún no tiene código (cliente
    // creado por el bot, estado 'borrador') y el front pide registrar, genera el
    // código, pasa a 'pendiente' y manda el correo de bienvenida al tutor.
    const esBorrador = !String(rows[idx].codigo || '').trim() || rows[idx].estado === 'borrador'
    let codigoGenerado = ''
    if (body.registrar === true && esBorrador) {
      const letra = String(candidate.letra_especie || '').trim()
      if (!letra) {
        return NextResponse.json({ error: 'Falta la especie: es necesaria para generar el código.' }, { status: 400 })
      }
      codigoGenerado = await generarCodigo(letra, String(candidate.codigo_servicio || 'CI'))
      updated.codigo = codigoGenerado
      if (!updated.estado || updated.estado === 'borrador') updated.estado = 'pendiente'
    }

    // Escribir. generarCodigo hace max+1 (no atómico): dos registros simultáneos
    // de la misma especie podrían generar el mismo código. Si existe el índice
    // único de `clientes.codigo` (ver supabase/schema-principal.sql), el segundo
    // write choca; lo detectamos, regeneramos y reintentamos. Sin el índice no
    // hay conflicto → este loop corre una sola vez.
    let intentosCodigo = 0
    for (;;) {
      try {
        await updateById('clientes', String(updated.id), updated)
        break
      } catch (e) {
        const msg = String(e).toLowerCase()
        const choqueCodigo = !!codigoGenerado && intentosCodigo < 3 &&
          (msg.includes('duplicate') || msg.includes('unique')) && msg.includes('codigo')
        if (!choqueCodigo) throw e
        intentosCodigo++
        codigoGenerado = await generarCodigo(String(candidate.letra_especie || '').trim(), String(candidate.codigo_servicio || 'CI'))
        updated.codigo = codigoGenerado
      }
    }

    // Correo de bienvenida con el código, solo al registrar (best-effort).
    if (codigoGenerado && String(updated.email || '').trim()) {
      try {
        await enviarRegistroMascota({
          email: String(updated.email),
          nombreMascota: String(updated.nombre_mascota || ''),
          nombreTutor: String(updated.nombre_tutor || ''),
          codigo: codigoGenerado,
          clienteId: String(updated.id || ''),
        })
      } catch (e) {
        console.warn('[clientes PATCH] fallo mail registro (no bloqueante):', e)
      }
    }

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
 *  - Quita el id del cliente del despacho asociado: columnas JSON `mascotas_ids`,
 *    `paradas` y `entregas` (regenerando el orden de las paradas restantes).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    const role = (session?.user as { role?: string })?.role
    if (!esAdmin(role)) {
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
            await updateById('ciclos', ciclo.id, { ...ciclo, mascotas_ids: filtrados.join(',') })
          }
        }
      } catch (err) {
        console.warn('[clientes/delete] no se pudo limpiar referencia en ciclo:', err)
      }
    }

    // 3) Limpiar referencia en el despacho (si tenía uno). Las tres listas son
    // JSON (no CSV): mascotas_ids [array], paradas [array de {cliente_id,…}],
    // entregas {por cliente}. Quitamos la mascota de las tres y reordenamos las
    // paradas restantes (mismo formato que despachos POST/PATCH).
    if (cliente.despacho_id) {
      try {
        const despachos = await getSheetData('despachos')
        const didx = despachos.findIndex(d => d.id === cliente.despacho_id)
        if (didx !== -1) {
          const desp = despachos[didx]
          const mascotasIds = parseJsonSafe<string[]>(desp.mascotas_ids, [])
          const paradas = parseJsonSafe<Parada[]>(desp.paradas, [])
          const entregas = parseJsonSafe<Record<string, { fecha_hora: string }>>(desp.entregas, {})
          const estaReferenciado =
            mascotasIds.some(m => String(m) === id) ||
            paradas.some(p => String(p.cliente_id) === id) ||
            entregas[id] !== undefined
          if (estaReferenciado) {
            const nuevasMascotas = mascotasIds.filter(m => String(m) !== id)
            const nuevasParadas = paradas
              .filter(p => String(p.cliente_id) !== id)
              .map((p, i) => ({ ...p, orden: i + 1 }))
            const nuevasEntregas: Record<string, { fecha_hora: string }> = {}
            for (const [k, v] of Object.entries(entregas)) if (k !== id) nuevasEntregas[k] = v
            await updateById('despachos', desp.id, {
              ...desp,
              mascotas_ids: JSON.stringify(nuevasMascotas),
              paradas: JSON.stringify(nuevasParadas),
              entregas: JSON.stringify(nuevasEntregas),
            })
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
type Parada = { cliente_id: string; orden?: number; lat?: number; lng?: number; direccion?: string }

function parseAdicionales(raw: string | undefined): AdicionalItem[] {
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
}

/** Parseo JSON tolerante: devuelve fallback si el valor está vacío o no es JSON. */
function parseJsonSafe<T>(raw: string | undefined, fallback: T): T {
  try { const x = JSON.parse(raw || ''); return (x ?? fallback) as T } catch { return fallback }
}

async function adjustProductStock(
  oldItems: AdicionalItem[],
  newItems: AdicionalItem[]
) {
  // Build qty maps for products only
  const oldQty: Record<string, number> = {}
  const newQty: Record<string, number> = {}
  oldItems.filter(a => a.tipo === 'producto').forEach(a => { oldQty[a.id] = (oldQty[a.id] || 0) + (a.qty ?? 1) })
  newItems.filter(a => a.tipo === 'producto').forEach(a => { newQty[a.id] = (newQty[a.id] || 0) + (a.qty ?? 1) })

  const allIds = new Set([...Object.keys(oldQty), ...Object.keys(newQty)])
  // Secuencial (no Promise.all): cada ajuste es un compare-and-set atómico que
  // relee el stock, así no se pierden unidades entre productos ni frente a otra
  // venta/edición concurrente del mismo producto.
  for (const pid of allIds) {
    const delta = (oldQty[pid] || 0) - (newQty[pid] || 0) // positive = freed, negative = consumed
    if (delta === 0) continue
    await ajustarStock(pid, delta)
  }
}
