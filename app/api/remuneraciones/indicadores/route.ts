import { NextRequest, NextResponse } from 'next/server'
import { guard } from '@/lib/remuneraciones/auth'
import { FUENTES_OFICIALES, obtenerIndicadores } from '@/lib/remuneraciones/indicadores'
import { autocompletarPeriodo } from '@/lib/remuneraciones/parametros'
import { esPeriodoValido } from '@/lib/remuneraciones/periodo'

export const dynamic = 'force-dynamic'

/** Consulta la UF y la UTM del período SIN guardar nada (para previsualizar). */
export async function GET(req: NextRequest) {
  const g = await guard('ver')
  if (g.denegado) return g.denegado
  const periodo = (req.nextUrl.searchParams.get('periodo') || '').trim()
  if (!esPeriodoValido(periodo)) {
    return NextResponse.json({ error: 'El período debe tener el formato YYYY-MM' }, { status: 400 })
  }
  try {
    const ind = await obtenerIndicadores(periodo)
    return NextResponse.json({ ...ind, fuentes: FUENTES_OFICIALES })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 })
  }
}

/** Trae la UF y la UTM y las deja guardadas en el período. */
export async function POST(req: NextRequest) {
  const g = await guard('editar')
  if (g.denegado) return g.denegado
  try {
    const body = await req.json().catch(() => ({}))
    const periodo = String(body?.periodo || '')
    if (!esPeriodoValido(periodo)) {
      return NextResponse.json({ error: 'El período debe tener el formato YYYY-MM' }, { status: 400 })
    }
    const resultado = await autocompletarPeriodo(periodo, { forzar: body?.forzar === true })
    return NextResponse.json({ ...resultado, fuentes: FUENTES_OFICIALES })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 })
  }
}
