import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { getSheetData, updateByIdIf } from '@/lib/datastore'
import { emitirBoletaFicha } from '@/lib/facturacion'

/**
 * POST /api/facturacion/pendientes/[id]/reintentar
 * Reintenta manualmente la boleta automática de una ficha "pagada sin boleta"
 * (ver GET /api/facturacion/pendientes). Mismas guardas que la emisión automática
 * del PATCH de clientes: solo si sigue pagada, sin veterinaria y sin boleta_id ya
 * asignado — evita doble emisión si dos personas reintentan a la vez.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!esAdminTotal((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }

  const { id } = await params
  const rows = await getSheetData('clientes')
  const ficha = rows.find(c => String(c.id) === String(id))
  if (!ficha) return NextResponse.json({ error: 'Ficha no encontrada' }, { status: 404 })
  if (String(ficha.estado_pago || '').toLowerCase() !== 'pagado') {
    return NextResponse.json({ error: 'La ficha ya no está en estado pagado.' }, { status: 400 })
  }
  if (String(ficha.boleta_id || '').trim()) {
    return NextResponse.json({ error: 'Esta ficha ya tiene una boleta asignada.' }, { status: 400 })
  }

  const r = await emitirBoletaFicha(ficha, { creadoPorNombre: 'Reintento manual (Facturación)' })
  if (!r.ok || !r.documento?.id) {
    return NextResponse.json({ error: r.error || 'No se pudo emitir la boleta.' }, { status: 500 })
  }

  const gano = await updateByIdIf('clientes', String(ficha.id), { boleta_id: '' }, { boleta_id: String(r.documento.id) })
  if (!gano) {
    return NextResponse.json({ error: 'La ficha ya tenía boleta asignada (carrera con otro reintento).' }, { status: 409 })
  }

  return NextResponse.json({ ok: true, documento: r.documento })
}
