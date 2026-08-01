import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { guard } from '@/lib/remuneraciones/auth'
import { guardarLiquidacion, listarLiquidaciones } from '@/lib/remuneraciones/datos'
import {
  calcularPeriodo, contextoPeriodo, esPeriodoValido, totalesPeriodo,
} from '@/lib/remuneraciones/periodo'

export const dynamic = 'force-dynamic'

const MontoNombrado = z.object({ nombre: z.string(), monto: z.number() })

const NovedadesSchema = z.object({
  cremaciones: z.number().optional(),
  dias_trabajados: z.number().optional(),
  dias_efectivos: z.number().optional(),
  dias_descanso: z.number().optional(),
  horas_extra: z.number().optional(),
  otros_imponibles: z.array(MontoNombrado).optional(),
  otros_no_imponibles: z.array(MontoNombrado).optional(),
  otros_descuentos: z.array(MontoNombrado).optional(),
  anticipos: z.number().optional(),
}).partial()

const BodySchema = z.object({
  /** Novedades por empleado: { "3": { horas_extra: 4, anticipos: 50000 } } */
  novedades: z.record(z.string(), NovedadesSchema).optional().default({}),
  /** Corrección manual del conteo de cremaciones del mes. */
  cremaciones: z.number().optional(),
}).optional().default({ novedades: {} })

/**
 * Recalcula el período y GUARDA las liquidaciones en borrador. Es idempotente:
 * pisa la liquidación de cada empleado (hay una constraint única por período y
 * empleado). Un período ya cerrado o pagado hay que reabrirlo primero.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ periodo: string }> }) {
  const { denegado } = await guard('editar')
  if (denegado) return denegado
  const { periodo } = await params
  if (!esPeriodoValido(periodo)) {
    return NextResponse.json({ error: 'El período debe tener el formato YYYY-MM' }, { status: 400 })
  }

  try {
    const body = BodySchema.parse(await req.json().catch(() => ({})))
    const ctx = await contextoPeriodo(periodo)

    if (ctx.faltantes.length) {
      return NextResponse.json({ error: ctx.faltantes.join(' ') }, { status: 400 })
    }
    const cerradas = ctx.guardadas.filter(g => g.estado !== 'borrador')
    if (cerradas.length) {
      return NextResponse.json(
        { error: 'El período está cerrado. Reábrelo para poder recalcularlo.' },
        { status: 409 },
      )
    }
    if (!ctx.empleados.length) {
      return NextResponse.json({ error: 'No hay empleados activos que liquidar.' }, { status: 400 })
    }

    const resultados = calcularPeriodo(ctx, body.novedades, body.cremaciones)

    // Un appendRow/updateById por fila, en serie: getNextId tiene que ir fresco
    // por cada inserción.
    for (const r of resultados) {
      await guardarLiquidacion({
        periodo,
        empleado: r.empleado,
        liquidacion: r.liquidacion,
        solver: r.solver,
        novedades: r.novedades,
        parametros: ctx.parametros!,
        estado: 'borrador',
      })
    }

    return NextResponse.json({
      periodo,
      guardadas: await listarLiquidaciones(periodo),
      totales: totalesPeriodo(resultados),
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}
