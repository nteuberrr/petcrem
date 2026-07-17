import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { listarVentasFactura } from '@/lib/facturacion-ventas'

export const dynamic = 'force-dynamic'

/**
 * GET /api/facturacion/ventas-factura?mes=YYYY-MM&q
 * Todas las ventas a veterinaria (B2B) con su monto y el estado de su factura
 * (emitida o no). Alimenta la pestaña Facturas (facturar por ficha individual o
 * ver lo pendiente del mes). Solo admin.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!esAdminTotal((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  const sp = req.nextUrl.searchParams
  try {
    const ventas = await listarVentasFactura({
      mes: sp.get('mes') || undefined,
      q: sp.get('q') || undefined,
    })
    return NextResponse.json({ ventas })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 })
  }
}
