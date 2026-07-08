import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { isGoogleAdsConfigurado, esTokenVencido } from '@/lib/google-ads'
import { auditarCuenta } from '@/lib/google-ads-audit'

/**
 * GET /api/mailing/google-ads/audit — auditoría de la cuenta de Google Ads (Fase B):
 * bidding vs playbook, valores de conversión, RSAs, recursos, keywords basura,
 * Impression Share perdido, negativas, higiene. Solo admin-total.
 */
export const maxDuration = 60

async function esDueño(): Promise<boolean> {
  const session = await getServerSession(authOptions)
  return esAdminTotal((session?.user as { role?: string })?.role)
}

export async function GET() {
  if (!(await esDueño())) return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  if (!isGoogleAdsConfigurado()) {
    return NextResponse.json({ error: 'Google Ads no está configurado (faltan credenciales OAuth/developer token).' }, { status: 400 })
  }
  try {
    const hallazgos = await auditarCuenta()
    return NextResponse.json({ hallazgos })
  } catch (e) {
    if (esTokenVencido(e)) return NextResponse.json({ error: 'El acceso a Google Ads venció. Regeneralo con scripts/google-ads-refresh-token.ts.', tokenVencido: true }, { status: 502 })
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 502 })
  }
}
