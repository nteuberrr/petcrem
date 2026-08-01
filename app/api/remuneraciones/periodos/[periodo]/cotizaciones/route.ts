import { NextRequest, NextResponse } from 'next/server'
import { guard } from '@/lib/remuneraciones/auth'
import { filasCotizacion } from '@/lib/remuneraciones/cotizaciones'
import { listarEmpleados, listarLiquidaciones } from '@/lib/remuneraciones/datos'
import { esPeriodoValido } from '@/lib/remuneraciones/periodo'

export const dynamic = 'force-dynamic'

/** Lo que hay que declarar en Previred este mes, trabajador por trabajador. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ periodo: string }> }) {
  const g = await guard('ver')
  if (g.denegado) return g.denegado
  const { periodo } = await params
  if (!esPeriodoValido(periodo)) {
    return NextResponse.json({ error: 'El período debe tener el formato YYYY-MM' }, { status: 400 })
  }
  try {
    const [liquidaciones, empleados] = await Promise.all([
      listarLiquidaciones(periodo),
      listarEmpleados(true),
    ])
    const filas = filasCotizacion(liquidaciones, empleados)
    return NextResponse.json({
      periodo,
      filas,
      total: filas.reduce((s, f) => s + f.total, 0),
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
