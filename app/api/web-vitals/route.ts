import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdmin } from '@/lib/roles'
import { registrarVital, resumenVitals } from '@/lib/web-vitals'

export const dynamic = 'force-dynamic'

/**
 * Velocidad real del sitio público (Core Web Vitals de visitantes reales).
 *
 *  POST → lo llama el script del sitio con sendBeacon. Ruta PÚBLICA (el visitante
 *         no tiene sesión). No recibe ningún dato personal: solo ruta, tipo de
 *         dispositivo, si vino de un anuncio y los tiempos.
 *  GET  → resumen p75 de los últimos N días (admin).
 */

/** Número saneado dentro de un rango razonable; fuera de rango o basura → null. */
function num(v: unknown, max: number): number | null {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > max) return null
  return Math.round(n * 1000) / 1000
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => null) as Record<string, unknown> | null
    if (!b) return NextResponse.json({ ok: false }, { status: 400 })

    const lcp = num(b.lcp, 120_000)      // >2 min es basura o una pestaña olvidada
    const ttfb = num(b.ttfb, 120_000)
    if (lcp == null && ttfb == null) return NextResponse.json({ ok: true })  // nada útil, se descarta en silencio

    await registrarVital({
      ruta: String(b.ruta ?? '/').slice(0, 120),
      dispositivo: b.dispositivo === 'movil' ? 'movil' : 'escritorio',
      fuente: b.fuente === 'ads' ? 'ads' : 'organico',
      lcp, ttfb,
      cls: num(b.cls, 10),
      inp: num(b.inp, 60_000),
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    // Nunca devolver error al visitante por un problema de medición.
    console.error('[web-vitals POST]', e)
    return NextResponse.json({ ok: true })
  }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!esAdmin((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  try {
    const dias = Math.min(90, Math.max(1, parseInt(new URL(req.url).searchParams.get('dias') || '28', 10) || 28))
    return NextResponse.json(await resumenVitals(dias), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[web-vitals GET]', e)
    return NextResponse.json({ error: 'No se pudo leer la velocidad del sitio.' }, { status: 500 })
  }
}
