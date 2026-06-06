import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, updateRow } from '@/lib/google-sheets'
import { enviarEntregaConfirmada } from '@/lib/cliente-mailer'

export const dynamic = 'force-dynamic'

/**
 * POST /api/despachos/[id]/entregar  body: { cliente_id, deshacer? }
 * Marca (o desmarca) una mascota como entregada dentro de la ruta:
 *  - Registra la entrega en `entregas` con su fecha/hora.
 *  - Pone la mascota en estado 'despachado' y la vincula al despacho.
 *  - Envía el correo de entrega + reseña al tutor (solo al marcar, no al deshacer).
 * Si la ruta estaba 'guardada', la pasa a 'en_curso' (sin reenviar el correo de inicio).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const clienteId = String(body.cliente_id ?? '')
    const deshacer = body.deshacer === true
    if (!clienteId) return NextResponse.json({ error: 'cliente_id requerido' }, { status: 400 })

    const rows = await getSheetData('despachos')
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'Ruta no encontrada' }, { status: 404 })
    const row = rows[idx]

    let mascotasIds: string[] = []
    try { mascotasIds = JSON.parse(row.mascotas_ids || '[]') } catch {}
    if (!mascotasIds.includes(clienteId)) {
      return NextResponse.json({ error: 'La mascota no pertenece a esta ruta' }, { status: 400 })
    }

    let entregas: Record<string, { fecha_hora: string }> = {}
    try { entregas = JSON.parse(row.entregas || '{}') } catch {}

    const now = new Date().toISOString()
    const clientes = await getSheetData('clientes')
    const cIdx = clientes.findIndex(c => c.id === clienteId)

    if (deshacer) {
      delete entregas[clienteId]
      if (cIdx !== -1 && clientes[cIdx].despacho_id === id) {
        await updateRow('clientes', cIdx, { ...clientes[cIdx], estado: 'cremado', despacho_id: '' })
      }
      await updateRow('despachos', idx, { ...row, entregas: JSON.stringify(entregas) })
      return NextResponse.json({ ok: true, entregada: false })
    }

    if (entregas[clienteId]) {
      return NextResponse.json({ ok: true, ya_entregada: true })
    }
    entregas[clienteId] = { fecha_hora: now }

    const partial: Record<string, string> = { ...row, entregas: JSON.stringify(entregas) }
    // Si aún estaba "guardada", al entregar la primera ya está en curso.
    if (row.estado_ruta !== 'terminada' && row.estado_ruta !== 'en_curso') {
      partial.estado_ruta = 'en_curso'
      if (!row.hora_inicio_ruta) partial.hora_inicio_ruta = now
    }
    await updateRow('despachos', idx, partial)

    if (cIdx !== -1) {
      await updateRow('clientes', cIdx, { ...clientes[cIdx], estado: 'despachado', despacho_id: id })
      // Correo de entrega + reseña (best-effort).
      try {
        await enviarEntregaConfirmada({
          email: clientes[cIdx].email,
          nombreMascota: clientes[cIdx].nombre_mascota,
          nombreTutor: clientes[cIdx].nombre_tutor,
          codigo: clientes[cIdx].codigo,
        })
      } catch (e) {
        console.warn('[despachos/entregar] fallo correo entrega (no bloqueante):', e)
      }
    }

    return NextResponse.json({ ok: true, entregada: true, fecha_hora: now })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
