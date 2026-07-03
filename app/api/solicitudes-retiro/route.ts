import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdmin } from '@/lib/roles'
import { listarSolicitudesPendientes, listarSolicitudesConfirmadas, resolverSolicitudRetiro } from '@/lib/solicitudes-retiro'
import { listarEutanasiasCronograma } from '@/lib/eutanasia-cotizaciones'

export const dynamic = 'force-dynamic'

/**
 * Panel de solicitudes de retiro del bot de WhatsApp.
 *   GET  → cualquier usuario logueado: pendientes + confirmadas + eutanasias
 *          (todos deben ver las notificaciones en el dashboard). RESOLVERLAS
 *          (confirmar/rechazar) sigue siendo solo de admin — la UI le oculta
 *          los botones al operador y el POST revalida el rol.
 *   POST { id, accion: 'confirmar' | 'rechazar' } → mismo efecto que el botón de
 *          WhatsApp (crea la ficha borrador + avisa al cliente). Canal confiable,
 *          sin depender de la ventana de 24h de WhatsApp. Solo admin.
 */

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  try {
    const [pendientes, confirmadas, eutanasias] = await Promise.all([
      listarSolicitudesPendientes(),
      listarSolicitudesConfirmadas(),
      listarEutanasiasCronograma(),
    ])
    return NextResponse.json({ pendientes, confirmadas, eutanasias }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[solicitudes-retiro GET]', e)
    return NextResponse.json({ error: 'No se pudieron cargar las solicitudes.' }, { status: 500 })
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
