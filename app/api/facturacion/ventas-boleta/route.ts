import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { listarVentasBoleta } from '@/lib/facturacion-ventas'

export const dynamic = 'force-dynamic'

/**
 * GET /api/facturacion/ventas-boleta?desde&hasta&q
 * Todas las ventas a tutor (B2C) con su monto y el estado de su boleta (emitida o
 * no). Reemplaza la vista de "solo documentos emitidos" para las boletas. Solo admin.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!esAdminTotal((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  const sp = req.nextUrl.searchParams
  try {
    const ventas = await listarVentasBoleta({
      desde: sp.get('desde') || undefined,
      hasta: sp.get('hasta') || undefined,
      q: sp.get('q') || undefined,
    })
    return NextResponse.json({ ventas })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 })
  }
}
