import { NextRequest, NextResponse } from 'next/server'
import { guard } from '@/lib/remuneraciones/auth'
import { cambiarEstadoPeriodo, guardarPago, listarLiquidaciones } from '@/lib/remuneraciones/datos'
import { esPeriodoValido } from '@/lib/remuneraciones/periodo'
import { todayISO } from '@/lib/dates'

export const dynamic = 'force-dynamic'

/**
 * Marca el período como pagado y deja registrada la orden de pago del mes.
 *
 * Es el momento en que el costo aparece en el Estado de Resultados: el EERR lee
 * directo las liquidaciones con estado `pagada` (lib/remuneraciones/eerr.ts), no
 * se escribe ninguna fila de gasto manual — así una corrección posterior se
 * refleja sola y nunca queda contada dos veces.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ periodo: string }> }) {
  const { denegado, actor } = await guard('editar')
  if (denegado) return denegado
  const { periodo } = await params
  if (!esPeriodoValido(periodo)) {
    return NextResponse.json({ error: 'El período debe tener el formato YYYY-MM' }, { status: 400 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const fechaPago = String(body?.fecha_pago || todayISO())
    const comentarios = String(body?.comentarios || '')

    const guardadas = await listarLiquidaciones(periodo)
    if (!guardadas.length) {
      return NextResponse.json({ error: 'El período no tiene liquidaciones calculadas.' }, { status: 400 })
    }
    if (guardadas.some(g => g.estado === 'borrador')) {
      return NextResponse.json(
        { error: 'Cierra el período antes de marcarlo como pagado.' },
        { status: 409 },
      )
    }

    const totales = guardadas.reduce(
      (acc, g) => ({
        liquidos: acc.liquidos + g.liquido,
        reembolsos: acc.reembolsos + g.reembolso_salud,
        transferido: acc.transferido + g.total_a_transferir,
        costo: acc.costo + g.costo_empresa,
      }),
      { liquidos: 0, reembolsos: 0, transferido: 0, costo: 0 },
    )

    await cambiarEstadoPeriodo(periodo, 'pagada', { fecha_pago: fechaPago })
    const pago = await guardarPago({
      periodo,
      liquidacion_ids: guardadas.map(g => g.id),
      total_liquidos: totales.liquidos,
      total_reembolsos: totales.reembolsos,
      total_transferido: totales.transferido,
      costo_empresa: totales.costo,
      fecha_pago: fechaPago,
      comentarios,
      creado_por: actor.nombre,
    })

    return NextResponse.json({ periodo, estado: 'pagada', pago, liquidaciones: await listarLiquidaciones(periodo) })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
