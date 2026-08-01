import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { autocompletarPeriodo } from '@/lib/remuneraciones/parametros'
import { fechaChileISO } from '@/lib/dates'

/**
 * Deja los parámetros legales del mes al día, solo.
 *
 * Corre a diario y toca dos períodos:
 *  - el MES EN CURSO, para que exista desde el día 1 con su UF y su UTM;
 *  - el MES ANTERIOR, porque la UF definitiva de cierre recién se conoce cuando
 *    el mes termina (durante el mes se guarda la última publicada, provisional).
 *
 * Nunca pisa un valor cargado a mano: `autocompletarPeriodo` solo completa lo
 * que está vacío. Si alguien corrigió la UF, se respeta.
 *
 * Auth: Bearer CRON_SECRET (lo manda Vercel) o sesión de admin total.
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

/** 'YYYY-MM' de hoy en Chile, y el mes anterior. */
function periodosAActualizar(): string[] {
  const hoy = fechaChileISO()
  const actual = hoy.slice(0, 7)
  const [a, m] = actual.split('-').map(Number)
  const anterior = m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`
  return [anterior, actual]
}

export async function GET(req: NextRequest) {
  if (!(await autorizado(req))) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  try {
    const resultados = []
    // En serie: cada período puede copiar las tasas del anterior, así que el
    // orden importa.
    for (const periodo of periodosAActualizar()) {
      resultados.push(await autocompletarPeriodo(periodo))
    }
    return NextResponse.json({ ok: true, resultados })
  } catch (e) {
    console.error('[cron-remuneraciones]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 })
  }
}
