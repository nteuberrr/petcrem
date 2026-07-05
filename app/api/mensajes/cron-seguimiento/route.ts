import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdmin } from '@/lib/roles'
import { enviarSeguimientosPendientes } from '@/lib/seguimiento-leads'

/**
 * Seguimiento automático de leads tibios de WhatsApp (los que cotizaron y no
 * cerraron). Lo dispara el cron diario (vía /api/mensajes/cron-archivar) y
 * también se puede llamar a mano para probar. Auth: Bearer CRON_SECRET o admin.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function autorizado(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') || ''
    const a = crypto.createHash('sha256').update(auth).digest()
    const b = crypto.createHash('sha256').update(`Bearer ${secret}`).digest()
    if (crypto.timingSafeEqual(a, b)) return true
  }
  const session = await getServerSession(authOptions)
  return esAdmin((session?.user as { role?: string })?.role)
}

export async function GET(req: NextRequest) {
  if (!(await autorizado(req))) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  try {
    const r = await enviarSeguimientosPendientes()
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    console.error('[cron-seguimiento]', e)
    return NextResponse.json({ error: 'Error en el seguimiento' }, { status: 500 })
  }
}
