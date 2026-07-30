import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { anularDocumento } from '@/lib/facturacion'

interface Body { motivo?: string; dev?: boolean; monto?: number | string }

/**
 * POST /api/facturacion/[id]/anular — emite una NC (61) sobre un documento. Solo admin.
 *
 * Sin `monto` → anulación TOTAL (el documento queda 'anulado' y su ficha se libera).
 * Con `monto` → ABONO PARCIAL: acredita solo esa parte y el documento sigue vigente
 * por el saldo. Aplica igual a boletas (incluidas las de fichas de convenio) y facturas.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  const user = session?.user as { role?: string; id?: string; name?: string } | undefined
  if (!esAdminTotal(user?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  const { id } = await params
  const body = await req.json().catch(() => ({})) as Body

  // `monto` presente (>0) = abono parcial. Vacío/ausente = anulación total.
  const montoRaw = body.monto === undefined || body.monto === null || body.monto === ''
    ? undefined
    : Math.round(Number(body.monto))
  if (montoRaw !== undefined && (!Number.isFinite(montoRaw) || montoRaw <= 0)) {
    return NextResponse.json({ error: 'Monto a acreditar inválido.' }, { status: 400 })
  }

  const r = await anularDocumento({
    documentoId: id,
    motivo: body.motivo?.trim() || '',
    dev: !!body.dev,
    monto: montoRaw,
    creadoPorId: user?.id || '',
    creadoPorNombre: user?.name || '',
  })

  if (!r.ok) {
    // Las guardas de negocio (monto > saldo, total sobre un doc ya abonado) son
    // errores del usuario, no del proveedor → 400, no 502.
    const esGuarda = /monto|saldo|notas de crédito|ya fue anulado|no se puede anular/i.test(r.error || '')
    return NextResponse.json(
      { error: r.error || 'No se pudo anular el documento.' },
      { status: esGuarda ? 400 : 502 },
    )
  }
  return NextResponse.json({ ok: true, notaCredito: r.documento, parcial: montoRaw !== undefined })
}
