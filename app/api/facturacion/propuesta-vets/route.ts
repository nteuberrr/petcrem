import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { construirPropuestaMes } from '@/lib/facturacion-vets'
import { puedeNivel } from '@/lib/permisos-server'

/** GET /api/facturacion/propuesta-vets?mes=YYYY-MM — propuesta de facturación mensual por veterinaria. Solo admin. */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!(await puedeNivel('facturacion', 'ver'))) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  const mes = req.nextUrl.searchParams.get('mes') || ''
  if (!/^\d{4}-\d{2}$/.test(mes)) {
    return NextResponse.json({ error: 'Parámetro mes inválido (esperado YYYY-MM).' }, { status: 400 })
  }
  try {
    const propuesta = await construirPropuestaMes(mes)
    return NextResponse.json(propuesta)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 })
  }
}
