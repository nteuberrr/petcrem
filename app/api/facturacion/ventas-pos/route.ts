import { NextRequest, NextResponse } from 'next/server'
import { resumenVentasPos } from '@/lib/facturacion-pos'
import { puedeNivel } from '@/lib/permisos-server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/facturacion/ventas-pos?desde&hasta
 * Ventas cobradas por POS / link de pago agrupadas por día, con la comisión del
 * procesador descontada y el día hábil en que Haulmer abona cada jornada.
 */
export async function GET(req: NextRequest) {
  if (!(await puedeNivel('facturacion', 'ver'))) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
  }
  const sp = req.nextUrl.searchParams
  try {
    const resumen = await resumenVentasPos({
      desde: sp.get('desde') || undefined,
      hasta: sp.get('hasta') || undefined,
    })
    return NextResponse.json(resumen)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 })
  }
}
