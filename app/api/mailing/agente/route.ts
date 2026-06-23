import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { generarRespuestaMarketing, isMarketingAgenteConfigurado, type TurnoMarketing } from '@/lib/marketing-agente'

/**
 * POST /api/mailing/agente  (admin)
 * Chat con el agente de marketing. Body: { historial: [{rol,texto}] }.
 * Devuelve { mensaje, acciones, cambios } (cambios=true → refrescar el calendario).
 */
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!esAdminTotal((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  if (!isMarketingAgenteConfigurado()) {
    return NextResponse.json({ error: 'El agente no está configurado (falta ANTHROPIC_API_KEY).' }, { status: 400 })
  }
  try {
    const body = (await req.json()) as { historial?: TurnoMarketing[] }
    const historial = Array.isArray(body.historial) ? body.historial : []
    if (historial.length === 0) {
      return NextResponse.json({ error: 'Falta el historial de la conversación.' }, { status: 400 })
    }
    const creadoPor = session?.user?.name || session?.user?.email || ''
    const r = await generarRespuestaMarketing(historial, { creadoPor })
    return NextResponse.json(r)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[mailing/agente]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
