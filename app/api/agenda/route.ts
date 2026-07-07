import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { listarAgenda } from '@/lib/agenda'

export const dynamic = 'force-dynamic'

/**
 * Agenda semanal del dashboard (retiros de cremación + retiros de eutanasia).
 * GET ?from=YYYY-MM-DD&to=YYYY-MM-DD → { items } para el rango visible.
 * La ven todos los usuarios logueados (igual que las notificaciones del bot).
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  try {
    const { searchParams } = new URL(req.url)
    const from = searchParams.get('from') || undefined
    const to = searchParams.get('to') || undefined
    const items = await listarAgenda(from, to)
    return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[agenda GET]', e)
    return NextResponse.json({ error: 'No se pudo cargar la agenda.' }, { status: 500 })
  }
}
