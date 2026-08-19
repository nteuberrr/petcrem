import { NextRequest, NextResponse } from 'next/server'
import { conversacionPorTelefono } from '@/lib/mensajes'
import { isMensajesSupabaseConfigured } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/mensajes/por-telefono?tel=... → { id } | { id: null }
 *
 * Resuelve el chat de un teléfono. Lo usa el botón de WhatsApp de la ficha del
 * cliente, que enlaza a `/mensajes?tel=<telefono>`: el enlace no puede llevar el
 * id de la conversación porque la ficha no lo conoce (viven en tablas distintas)
 * y buscarlo al pintar cada ficha sería una consulta de más en la pantalla más
 * visitada del sistema. La resolución se hace acá, una sola vez, al abrir el inbox.
 */
export async function GET(req: NextRequest) {
  try {
    if (!isMensajesSupabaseConfigured()) return NextResponse.json({ error: 'Supabase no configurado' }, { status: 500 })
    const tel = req.nextUrl.searchParams.get('tel') || ''
    const conv = await conversacionPorTelefono(tel)
    return NextResponse.json({ id: conv?.id ?? null })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
