import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { ejecutarAvisosProgramados } from '@/lib/avisos'

/**
 * Cron de los AVISOS automáticos (Configuración Avanzada → Avisos).
 *
 * Corre CADA HORA y manda solo los avisos cuya hora configurada coincide con la
 * hora de Chile en ese momento (ver lib/avisos: un cron fijo en UTC se correría
 * una hora con el cambio de horario chileno). Idempotente por día.
 *
 * Auth: Bearer CRON_SECRET (lo manda Vercel) o sesión de admin total.
 * Ruta pública en proxy.ts, con esta auth interna.
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
  return esAdminTotal((session?.user as { role?: string })?.role)
}

export async function GET(req: NextRequest) {
  if (!(await autorizado(req))) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  try {
    // ?forzar=<clave> dispara un aviso ignorando hora/estado (para probar el cron).
    const forzar = req.nextUrl.searchParams.get('forzar') || undefined
    return NextResponse.json({ ok: true, ...(await ejecutarAvisosProgramados({ forzar })) })
  } catch (e) {
    console.error('[cron-avisos]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 })
  }
}
