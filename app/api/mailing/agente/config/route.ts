import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { getMarketingConfig, updateMarketingConfig } from '@/lib/marketing-config'

/**
 * /api/mailing/agente/config  (admin)
 *  GET → playbook actual del agente de marketing
 *  PUT { instrucciones?, calibracion? } → actualiza
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
  const cfg = await getMarketingConfig()
  return NextResponse.json(cfg)
}

export async function PUT(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const body = (await req.json()) as { instrucciones?: string; calibracion?: string }
    await updateMarketingConfig({
      instrucciones: body.instrucciones,
      calibracion: body.calibracion,
    })
    return NextResponse.json(await getMarketingConfig())
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[mailing/agente/config PUT]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
