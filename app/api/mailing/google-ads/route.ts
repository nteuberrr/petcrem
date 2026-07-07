import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { isGoogleAdsConfigurado, resumenCampanas, listarKeywords, terminosBusqueda } from '@/lib/google-ads'

/**
 * GET /api/mailing/google-ads?periodo=last_30d — campañas + keywords + términos
 * de búsqueda en vivo desde Google Ads (solo lectura). Solo admin-total, bajo el
 * mismo módulo `mailing` del proxy (prefijo /api/mailing).
 */
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!esAdminTotal((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  if (!isGoogleAdsConfigurado()) {
    return NextResponse.json({ error: 'Google Ads no está configurado (faltan credenciales OAuth/developer token).' }, { status: 400 })
  }
  const periodo = req.nextUrl.searchParams.get('periodo') || 'last_30d'
  try {
    const [ads, keywords, terminos] = await Promise.all([
      resumenCampanas(periodo),
      listarKeywords(periodo),
      terminosBusqueda(periodo),
    ])
    return NextResponse.json({ ads, keywords: keywords.keywords, terminos: terminos.terminos })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 502 })
  }
}
