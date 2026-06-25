import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { resumenAds, resumenOrganico, isInsightsConfigurado } from '@/lib/meta-insights'

/**
 * GET /api/mailing/metricas?que=ads|organico|ambos&periodo=last_30d  (admin)
 * Métricas en vivo de Meta para el dashboard: Ads pagados + posts orgánicos.
 */
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!esAdminTotal((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  if (!isInsightsConfigurado()) {
    return NextResponse.json({ error: 'Meta no está configurado (falta META_GRAPH_TOKEN).' }, { status: 400 })
  }
  const que = req.nextUrl.searchParams.get('que') || 'ambos'
  const periodo = req.nextUrl.searchParams.get('periodo') || 'last_30d'
  const out: { ads?: unknown; ads_error?: string; organico?: unknown; organico_error?: string } = {}
  if (que === 'ads' || que === 'ambos') {
    try { out.ads = await resumenAds({ datePreset: periodo }) }
    catch (e) { out.ads_error = e instanceof Error ? e.message : String(e) }
  }
  if (que === 'organico' || que === 'ambos') {
    try { out.organico = await resumenOrganico() }
    catch (e) { out.organico_error = e instanceof Error ? e.message : String(e) }
  }
  return NextResponse.json(out)
}
