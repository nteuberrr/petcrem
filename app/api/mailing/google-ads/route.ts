import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import {
  isGoogleAdsConfigurado, resumenCampanas, listarKeywords, terminosBusqueda, listarCampanasGestion,
  pausarCampanaGoogle, activarCampanaGoogle, ajustarPresupuestoGoogle,
  pausarKeywordGoogle, activarKeywordGoogle, agregarNegativaCampana,
} from '@/lib/google-ads'

/**
 * GET /api/mailing/google-ads?periodo=last_30d — campañas (rendimiento + gestión),
 * keywords y términos de búsqueda en vivo desde Google Ads. Solo admin-total.
 * POST — acciones de gestión (pausar/activar campaña o keyword, presupuesto,
 * agregar negativa). Bajo el mismo módulo `mailing` del proxy.
 */
export const maxDuration = 60

async function esDueño(): Promise<boolean> {
  const session = await getServerSession(authOptions)
  return esAdminTotal((session?.user as { role?: string })?.role)
}

export async function GET(req: NextRequest) {
  if (!(await esDueño())) return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  if (!isGoogleAdsConfigurado()) {
    return NextResponse.json({ error: 'Google Ads no está configurado (faltan credenciales OAuth/developer token).' }, { status: 400 })
  }
  const periodo = req.nextUrl.searchParams.get('periodo') || 'last_30d'
  try {
    const [ads, keywords, terminos, gestion] = await Promise.all([
      resumenCampanas(periodo),
      listarKeywords(periodo),
      terminosBusqueda(periodo),
      listarCampanasGestion(),
    ])
    return NextResponse.json({ ads, keywords: keywords.keywords, terminos: terminos.terminos, gestion: gestion.campanas })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 502 })
  }
}

interface Body {
  accion?: string
  campaignId?: string
  resourceName?: string
  montoClp?: number
  texto?: string
  matchType?: 'EXACT' | 'PHRASE' | 'BROAD'
}

export async function POST(req: NextRequest) {
  if (!(await esDueño())) return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  if (!isGoogleAdsConfigurado()) return NextResponse.json({ error: 'Google Ads no está configurado.' }, { status: 400 })
  const body = await req.json().catch(() => ({})) as Body
  try {
    switch (body.accion) {
      case 'pausar_campana': {
        if (!body.campaignId) return NextResponse.json({ error: 'Falta campaignId' }, { status: 400 })
        await pausarCampanaGoogle(body.campaignId)
        return NextResponse.json({ ok: true })
      }
      case 'activar_campana': {
        if (!body.campaignId) return NextResponse.json({ error: 'Falta campaignId' }, { status: 400 })
        await activarCampanaGoogle(body.campaignId)
        return NextResponse.json({ ok: true })
      }
      case 'presupuesto_campana': {
        if (!body.campaignId) return NextResponse.json({ error: 'Falta campaignId' }, { status: 400 })
        const monto = Number(body.montoClp)
        if (!Number.isFinite(monto) || monto <= 0) return NextResponse.json({ error: 'Monto inválido' }, { status: 400 })
        await ajustarPresupuestoGoogle(body.campaignId, monto)
        return NextResponse.json({ ok: true })
      }
      case 'pausar_keyword': {
        if (!body.resourceName) return NextResponse.json({ error: 'Falta resourceName' }, { status: 400 })
        await pausarKeywordGoogle(body.resourceName)
        return NextResponse.json({ ok: true })
      }
      case 'activar_keyword': {
        if (!body.resourceName) return NextResponse.json({ error: 'Falta resourceName' }, { status: 400 })
        await activarKeywordGoogle(body.resourceName)
        return NextResponse.json({ ok: true })
      }
      case 'negativa': {
        if (!body.campaignId || !body.texto?.trim()) return NextResponse.json({ error: 'Faltan datos' }, { status: 400 })
        await agregarNegativaCampana(body.campaignId, body.texto, body.matchType || 'PHRASE')
        return NextResponse.json({ ok: true })
      }
      default:
        return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 502 })
  }
}
