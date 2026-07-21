import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { calcularEmbudoSemanal } from '@/lib/embudo-semanal'

/**
 * GET /api/mailing/embudo?semanas=16  (admin-total)
 * Embudo de conversión por semana ISO: impresiones → clics → leads WA → ventas.
 */
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!esAdminTotal((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  const raw = parseInt(req.nextUrl.searchParams.get('semanas') || '16', 10)
  const semanas = Math.min(52, Math.max(4, Number.isFinite(raw) ? raw : 16))
  try {
    return NextResponse.json(await calcularEmbudoSemanal(semanas))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
