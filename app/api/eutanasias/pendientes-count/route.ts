import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { contarEutanasiasAbiertas } from '@/lib/eutanasia-cotizaciones'

/**
 * GET /api/eutanasias/pendientes-count — cantidad de eutanasias "sobre la marcha"
 * (no cerradas / no pagadas) para el badge del sidebar. Cualquier usuario logueado.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ count: 0 }, { status: 401 })
  try {
    return NextResponse.json({ count: await contarEutanasiasAbiertas() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[eutanasias/pendientes-count]', e)
    return NextResponse.json({ count: 0 }, { status: 500 })
  }
}
