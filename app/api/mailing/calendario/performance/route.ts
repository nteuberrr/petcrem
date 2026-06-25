import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { performancePosts, isInsightsConfigurado } from '@/lib/meta-insights'

/**
 * POST /api/mailing/calendario/performance  { ids: string[] }  (admin)
 * Devuelve { [post_externo_id]: interacciones } para destacar en el calendario
 * las piezas publicadas que rindieron bien. Best-effort.
 */
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!esAdminTotal((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  if (!isInsightsConfigurado()) return NextResponse.json({})
  try {
    const body = await req.json().catch(() => ({})) as { ids?: string[] }
    const ids = Array.isArray(body.ids) ? body.ids : []
    return NextResponse.json(await performancePosts(ids))
  } catch (e) {
    console.error('[mailing/calendario performance]', e)
    return NextResponse.json({})
  }
}
