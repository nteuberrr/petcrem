import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { marcarCobroPagado } from '@/lib/cobros'
import { getSheetData, updateByIdIf } from '@/lib/datastore'
import { emitirBoletaSiCorresponde } from '@/lib/facturacion'

/**
 * PATCH /api/cobros/[id]  — el equipo confirma que RECIBIÓ el pago de un cobro
 * (adicional / diferencia / saldo) → estado=pagado → cierra la cobranza (deja de
 * aparecer el banner en la ficha). Requiere sesión (mismo acceso que la ficha).
 *
 * Si el cobro es un 'saldo' de PAGO PARCIAL, al recibirlo la ficha queda PAGADA y
 * recién ahí se emite la boleta (por el total). Best-effort: no rompe el cierre.
 */
export async function PATCH(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  try {
    const { id } = await params
    const cobro = await marcarCobroPagado(id)
    if (!cobro) return NextResponse.json({ error: 'Cobro no encontrado' }, { status: 404 })

    let boletaId = ''
    if (cobro.tipo === 'saldo' && cobro.cliente_id) {
      try {
        const ficha = (await getSheetData('clientes')).find(f => String(f.id) === String(cobro.cliente_id))
        if (ficha && String(ficha.estado_pago || '').toLowerCase() !== 'pagado') {
          await updateByIdIf('clientes', String(ficha.id), {}, { estado_pago: 'pagado' })
          const r = await emitirBoletaSiCorresponde({ ...ficha, estado_pago: 'pagado' }, { creadoPorNombre: 'Automático (saldo de pago parcial recibido)' })
          if (r.boleta_id) boletaId = r.boleta_id
        }
      } catch (e) { console.warn('[cobros PATCH] cierre de saldo parcial falló:', e) }
    }

    return NextResponse.json({ ok: true, cobro, boleta_id: boletaId || undefined })
  } catch (e) {
    console.error('[cobros PATCH]', e)
    return NextResponse.json({ error: 'No se pudo actualizar el cobro.' }, { status: 500 })
  }
}
