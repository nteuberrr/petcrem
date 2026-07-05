import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdmin } from '@/lib/roles'
import { archivarConversacionesInactivas } from '@/lib/mensajes'

/**
 * Cron diario (Vercel): archiva las conversaciones ACTIVAS de WhatsApp con más
 * de 2 días sin actividad. Auth: Bearer CRON_SECRET (Vercel) o sesión admin.
 * Las que se volvieron negocio (cliente/cerrado) o de vets no se tocan.
 */
export const dynamic = 'force-dynamic'

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
    const n = await archivarConversacionesInactivas(2)
    return NextResponse.json({ ok: true, archivadas: n })
  } catch (e) {
    console.error('[cron-archivar]', e)
    return NextResponse.json({ error: 'Error al archivar' }, { status: 500 })
  }
}
