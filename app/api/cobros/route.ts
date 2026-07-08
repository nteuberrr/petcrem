import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { cobrosPendientesTodos } from '@/lib/cobros'

/**
 * GET /api/cobros — todos los cobros NO pagados (adicionales + diferencias), para la
 * notificación "pendiente de cobro" arriba de /clientes. Requiere sesión (mismo acceso
 * que la sección de clientes).
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  try {
    const cobros = await cobrosPendientesTodos()
    return NextResponse.json({ cobros })
  } catch (e) {
    console.error('[cobros GET]', e)
    return NextResponse.json({ cobros: [] })
  }
}
