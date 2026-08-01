import { NextRequest, NextResponse } from 'next/server'
import { guard } from '@/lib/remuneraciones/auth'
import { getPago } from '@/lib/remuneraciones/datos'
import {
  calcularPeriodo, contextoPeriodo, esPeriodoValido, totalesPeriodo,
} from '@/lib/remuneraciones/periodo'

export const dynamic = 'force-dynamic'

/**
 * Todo lo que necesita la pantalla del mes en una sola llamada: la base del
 * período (cremaciones + calendario + parámetros), las liquidaciones ya
 * guardadas y el cálculo en vivo de cada empleado.
 *
 * El cálculo NO se persiste acá: eso lo hace `calcular`.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ periodo: string }> }) {
  const g = await guard('ver')
  if (g.denegado) return g.denegado
  const { periodo } = await params
  if (!esPeriodoValido(periodo)) {
    return NextResponse.json({ error: 'El período debe tener el formato YYYY-MM' }, { status: 400 })
  }
  try {
    const ctx = await contextoPeriodo(periodo)
    const pago = await getPago(periodo)
    const resultados = calcularPeriodo(ctx)

    // El estado del período es el de sus liquidaciones: si no hay ninguna
    // guardada, está en borrador.
    const estados = new Set(ctx.guardadas.map(g => g.estado))
    const estado = estados.has('pagada') ? 'pagada' : estados.has('cerrada') ? 'cerrada' : 'borrador'

    return NextResponse.json({
      periodo,
      estado,
      parametros: ctx.parametros,
      faltantes: ctx.faltantes,
      calendario: ctx.calendario,
      cremaciones: ctx.cremaciones,
      empleados: ctx.empleados,
      guardadas: ctx.guardadas,
      pago,
      resultados: resultados.map(r => ({
        empleado_id: r.empleado.id,
        empleado_nombre: r.empleado.nombre_completo,
        cargo: r.empleado.cargo,
        afp: r.empleado.afp,
        prevision_salud: r.empleado.prevision_salud,
        novedades: r.novedades,
        liquidacion: r.liquidacion,
        solver: r.solver,
      })),
      totales: totalesPeriodo(resultados),
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
