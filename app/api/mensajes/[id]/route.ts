import { NextRequest, NextResponse } from 'next/server'
import { getConversacion, getMensajes, actualizarConversacion, vincularCliente, type EstadoConv } from '@/lib/mensajes'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET: conversación + sus mensajes en orden cronológico. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const conv = await getConversacion(Number(id))
    if (!conv) return NextResponse.json({ error: 'Conversación no encontrada' }, { status: 404 })
    const mensajes = await getMensajes(conv.id)
    return NextResponse.json({ conversacion: conv, mensajes })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

/** PATCH: actualiza estado / etiquetas / audiencia de la conversación o vincula cliente. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const conv = await getConversacion(Number(id))
    if (!conv) return NextResponse.json({ error: 'Conversación no encontrada' }, { status: 404 })

    const patch: { estado?: EstadoConv; etiquetas?: string[]; audiencia?: 'A' | 'B' | 'mixed' } = {}
    if (body.estado === 'abierta' || body.estado === 'cerrada') patch.estado = body.estado
    if (Array.isArray(body.etiquetas)) patch.etiquetas = body.etiquetas.map(String)
    if (body.audiencia === 'A' || body.audiencia === 'B' || body.audiencia === 'mixed') patch.audiencia = body.audiencia
    if (Object.keys(patch).length > 0) await actualizarConversacion(conv.id, patch)

    if ('cliente_id' in body) await vincularCliente(conv.contacto_id, body.cliente_id ? String(body.cliente_id) : null)

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
