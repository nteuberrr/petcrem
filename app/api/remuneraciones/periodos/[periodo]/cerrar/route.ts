import { NextRequest, NextResponse } from 'next/server'
import { guard } from '@/lib/remuneraciones/auth'
import { borrarPago, cambiarEstadoPeriodo, listarLiquidaciones } from '@/lib/remuneraciones/datos'
import { esPeriodoValido } from '@/lib/remuneraciones/periodo'

export const dynamic = 'force-dynamic'

/**
 * Cierra el período: las liquidaciones dejan de recalcularse y su snapshot
 * (detalle + parámetros usados) queda congelado. `{ reabrir: true }` revierte a
 * borrador — y si el período ya estaba pagado, además borra la orden de pago,
 * porque el costo dejaría de estar respaldado.
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
    const reabrir = body?.reabrir === true

    const guardadas = await listarLiquidaciones(periodo)
    if (!guardadas.length) {
      return NextResponse.json({ error: 'El período no tiene liquidaciones calculadas.' }, { status: 400 })
    }

    if (reabrir) {
      await cambiarEstadoPeriodo(periodo, 'borrador', { fecha_pago: '', cerrada_por: '' })
      // Sin liquidaciones pagadas no hay costo que respaldar en el EERR.
      await borrarPago(periodo)
    } else {
      await cambiarEstadoPeriodo(periodo, 'cerrada', { cerrada_por: actor.nombre })
    }

    return NextResponse.json({ periodo, estado: reabrir ? 'borrador' : 'cerrada', liquidaciones: await listarLiquidaciones(periodo) })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
