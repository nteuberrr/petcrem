import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { correrAutopilotoSemanal } from '@/lib/marketing-autopiloto'

/**
 * Disparo MANUAL del autopiloto de marketing (para el botón "Generar plan ahora" y
 * para pruebas). Planifica la semana si falta y genera hasta 5 piezas en esta
 * corrida (el cron externo de 10 min ya lo va empujando de a 1). Nada se publica.
 * Auth: sesión admin-total, o Bearer CRON_SECRET.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function autorizado(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') === `Bearer ${secret}`) return true
  const session = await getServerSession(authOptions)
  return esAdminTotal((session?.user as { role?: string })?.role)
}

async function ejecutar(req: NextRequest) {
  if (!(await autorizado(req))) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  try {
    const r = await correrAutopilotoSemanal({ maxGenerar: 5 })
    if (!r) return NextResponse.json({ ok: true, activo: false, mensaje: 'El autopiloto está desactivado.' })
    return NextResponse.json({ ok: true, activo: true, ...r })
  } catch (e) {
    console.error('[cron-autopiloto]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) { return ejecutar(req) }
export async function POST(req: NextRequest) { return ejecutar(req) }
