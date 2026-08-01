import { NextRequest, NextResponse } from 'next/server'
import { guard } from '@/lib/remuneraciones/auth'
import { listarLiquidaciones } from '@/lib/remuneraciones/datos'

export const dynamic = 'force-dynamic'

/** Histórico de liquidaciones. Sin `periodo` devuelve todas. */
export async function GET(req: NextRequest) {
  const g = await guard('ver')
  if (g.denegado) return g.denegado
  try {
    const periodo = (req.nextUrl.searchParams.get('periodo') || '').trim()
    const liquidaciones = await listarLiquidaciones(periodo || undefined)
    // El detalle completo pesa; el histórico solo necesita la cabecera.
    return NextResponse.json({
      liquidaciones: liquidaciones.map(({ detalle: _d, parametros: _p, novedades: _n, ...resto }) => resto),
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
