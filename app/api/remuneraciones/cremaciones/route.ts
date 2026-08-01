import { NextRequest, NextResponse } from 'next/server'
import { guard } from '@/lib/remuneraciones/auth'
import { cremacionesDelPeriodo } from '@/lib/cremaciones-mes'
import { esPeriodoValido } from '@/lib/remuneraciones/periodo'

export const dynamic = 'force-dynamic'

/**
 * Detalle de las mascotas efectivamente cremadas en el mes. Es el respaldo del
 * número que define el variable de cada operario: si el total no cuadra, acá se
 * ve ficha por ficha de dónde sale.
 */
export async function GET(req: NextRequest) {
  const g = await guard('ver')
  if (g.denegado) return g.denegado
  const periodo = (req.nextUrl.searchParams.get('periodo') || '').trim()
  if (!esPeriodoValido(periodo)) {
    return NextResponse.json({ error: 'El período debe tener el formato YYYY-MM' }, { status: 400 })
  }
  try {
    const fichas = await cremacionesDelPeriodo(periodo)
    return NextResponse.json({ periodo, total: fichas.length, fichas })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
