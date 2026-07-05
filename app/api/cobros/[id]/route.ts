import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { marcarCobroPagado } from '@/lib/cobros'

/**
 * PATCH /api/cobros/[id]  — el equipo confirma que RECIBIÓ el pago de un cobro
 * (adicional o diferencia) → estado=pagado → cierra la cobranza (deja de
 * aparecer el banner en la ficha). Requiere sesión (mismo acceso que la ficha).
 */
export async function PATCH(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  try {
    const { id } = await params
    const cobro = await marcarCobroPagado(id)
    if (!cobro) return NextResponse.json({ error: 'Cobro no encontrado' }, { status: 404 })
    return NextResponse.json({ ok: true, cobro })
  } catch (e) {
    console.error('[cobros PATCH]', e)
    return NextResponse.json({ error: 'No se pudo actualizar el cobro.' }, { status: 500 })
  }
}
