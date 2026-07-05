import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdmin } from '@/lib/roles'
import { contarNoLeidos } from '@/lib/mensajes'

/**
 * GET /api/mensajes/no-leidos-count — cantidad de conversaciones con mensajes
 * sin leer, para el "(N)" del ítem Mensajes en el sidebar. Solo admin (el módulo
 * Mensajes es admin-only).
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!esAdmin((session?.user as { role?: string })?.role)) return NextResponse.json({ count: 0 }, { status: 401 })
  try {
    return NextResponse.json({ count: await contarNoLeidos() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[mensajes/no-leidos-count]', e)
    return NextResponse.json({ count: 0 }, { status: 500 })
  }
}
