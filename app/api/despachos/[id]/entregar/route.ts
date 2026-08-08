import { NextRequest, NextResponse } from 'next/server'
import { registrarEntrega } from '@/lib/despacho-entrega'

export const dynamic = 'force-dynamic'

/**
 * POST /api/despachos/[id]/entregar  body: { cliente_id, deshacer? }
 * Marca (o desmarca) una mascota como entregada dentro de la ruta.
 *
 * La lógica vive en [lib/despacho-entrega.ts](../../../../../lib/despacho-entrega.ts)
 * porque la comparte con la hoja de ruta pública del delivery
 * (`/api/rutas/[token]`): marcar entregado tiene que hacer lo mismo desde el
 * panel que desde el link.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const r = await registrarEntrega(id, String(body.cliente_id ?? ''), { deshacer: body.deshacer === true })
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    if (r.tipo === 'ya_entregada') return NextResponse.json({ ok: true, ya_entregada: true })
    if (r.tipo === 'deshecha') return NextResponse.json({ ok: true, entregada: false, ruta_reabierta: r.ruta_reabierta })
    return NextResponse.json({ ok: true, entregada: true, fecha_hora: r.fecha_hora, ruta_terminada: r.ruta_terminada })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
