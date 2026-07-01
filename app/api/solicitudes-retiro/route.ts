import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdmin } from '@/lib/roles'
import { listarSolicitudesPendientes, resolverSolicitudRetiro } from '@/lib/solicitudes-retiro'

export const dynamic = 'force-dynamic'

/**
 * Panel de solicitudes de retiro del bot de WhatsApp (admin / admin2).
 *   GET  → lista de pendientes (para el badge + el panel).
 *   POST { id, accion: 'confirmar' | 'rechazar' } → mismo efecto que el botón de
 *          WhatsApp (crea la ficha borrador + avisa al cliente). Canal confiable,
 *          sin depender de la ventana de 24h de WhatsApp.
 */

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!esAdmin((session?.user as { role?: string })?.role)) return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  try {
    const pendientes = await listarSolicitudesPendientes()
    return NextResponse.json(pendientes, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!esAdmin((session?.user as { role?: string })?.role)) return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  try {
    const body = await req.json().catch(() => ({}))
    const id = String(body.id || '').trim()
    const accion = String(body.accion || '')
    if (!id || (accion !== 'confirmar' && accion !== 'rechazar')) {
      return NextResponse.json({ error: 'id y accion (confirmar|rechazar) son requeridos' }, { status: 400 })
    }
    const r = await resolverSolicitudRetiro(id, accion === 'confirmar')
    const status = r.resultado === 'no_existe' ? 404 : r.resultado === 'ya_resuelta' ? 409 : 200
    return NextResponse.json(r, { status })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
