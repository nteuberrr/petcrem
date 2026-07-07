import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { isAdsGestionConfigurado, listarCampanas, pausarCampana, activarCampana, ajustarPresupuesto } from '@/lib/meta-ads'

/**
 * Gestión de campañas de Meta Ads (Fase 1) — solo admin-total (dueño).
 *   GET  /api/mailing/ads                      → { moneda, campanas: [...] }
 *   POST /api/mailing/ads  { accion, campana_id, monto_clp? }
 *        accion = 'pausar' | 'activar' | 'presupuesto'
 * Gateada además por el módulo `mailing` en el proxy (prefijo /api/mailing).
 */
export const maxDuration = 60

async function esDueño(): Promise<boolean> {
  const session = await getServerSession(authOptions)
  return esAdminTotal((session?.user as { role?: string })?.role)
}

export async function GET() {
  if (!(await esDueño())) return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  if (!isAdsGestionConfigurado()) return NextResponse.json({ error: 'Meta no está configurado (falta META_GRAPH_TOKEN).' }, { status: 400 })
  try {
    return NextResponse.json(await listarCampanas())
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 502 })
  }
}

export async function POST(req: NextRequest) {
  if (!(await esDueño())) return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  if (!isAdsGestionConfigurado()) return NextResponse.json({ error: 'Meta no está configurado.' }, { status: 400 })
  const body = await req.json().catch(() => ({})) as { accion?: string; campana_id?: string; monto_clp?: number }
  const id = (body.campana_id || '').trim()
  if (!id) return NextResponse.json({ error: 'Falta campana_id' }, { status: 400 })
  try {
    if (body.accion === 'pausar') { await pausarCampana(id); return NextResponse.json({ ok: true }) }
    if (body.accion === 'activar') { await activarCampana(id); return NextResponse.json({ ok: true }) }
    if (body.accion === 'presupuesto') {
      const monto = Number(body.monto_clp)
      if (!Number.isFinite(monto) || monto <= 0) return NextResponse.json({ error: 'Monto inválido' }, { status: 400 })
      return NextResponse.json({ ok: true, ...(await ajustarPresupuesto(id, monto)) })
    }
    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 502 })
  }
}
