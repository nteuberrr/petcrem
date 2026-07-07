import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { getMarketingParams, updateMarketingParams, type MarketingParams } from '@/lib/marketing-params'

/**
 * /api/mailing/agente/params  (admin)
 *  GET → parámetros vigentes del plan de marketing (cadencia, pilares, ads, autopiloto).
 *  PUT { patch } → actualiza (merge). Lo cuantitativo/editable, no hardcodeado.
 */

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!esAdminTotal((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  return null
}

export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  return NextResponse.json(await getMarketingParams())
}

export async function PUT(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const body = (await req.json()) as Partial<MarketingParams>
    // No se edita el throttle interno por esta vía.
    delete (body as Record<string, unknown>).autopiloto_ultima_semana
    await updateMarketingParams(body)
    return NextResponse.json(await getMarketingParams())
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[mailing/agente/params PUT]', msg)
    // Pista útil si aún no se corrió el ALTER de la columna en Supabase.
    const hint = /parametros|column|schema cache/i.test(msg)
      ? 'Falta la columna marketing_config.parametros en la base. Corré: alter table "marketing_config" add column if not exists "parametros" text not null default \'\'; y notify pgrst.'
      : msg
    return NextResponse.json({ error: hint }, { status: 500 })
  }
}
