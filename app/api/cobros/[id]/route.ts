import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { marcarCobroPagado, esDevolucion, MEDIOS_PAGO, type MedioPago } from '@/lib/cobros'
import { getSheetData, updateByIdIf } from '@/lib/datastore'
import { emitirBoletaSiCorresponde, emitirBoletaCobroSiCorresponde, emitirNcDevolucionSiCorresponde } from '@/lib/facturacion'

/**
 * PATCH /api/cobros/[id]  — el equipo confirma el movimiento de plata de un cobro
 * (adicional / diferencia / saldo / devolución) → estado=pagado → cierra el asunto
 * (deja de aparecer el banner en la ficha). Requiere sesión (mismo acceso que la ficha).
 *
 * Documento tributario según el tipo (best-effort, nunca rompe el cierre):
 *  · 'saldo'  → completa el pago de la ficha: queda PAGADA y se emite la boleta
 *               por el TOTAL de la ficha.
 *  · 'adicional' / 'diferencia' → plata cobrada DESPUÉS de la boleta original:
 *               se emite una boleta propia por SOLO ese monto.
 *  · 'devolucion' → plata que SALE (se le devolvió al tutor): no se emite una
 *               boleta sino una NOTA DE CRÉDITO parcial sobre la boleta de la ficha.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  const usuario = session?.user as { id?: string; name?: string } | undefined
  if (!session?.user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  try {
    const { id } = await params
    // Con qué se recibió. Importa más allá del registro: un cobro cerrado con
    // MÁQUINA o LINK pasó por el procesador, así que tiene que aparecer en
    // Ventas POS (paga comisión y llega en el abono). Sin `medio` se conserva lo
    // que tuviera — y lo histórico, vacío, se lee como transferencia.
    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    const medioRaw = String((body as { medio?: unknown }).medio ?? '').toLowerCase()
    const medio = (MEDIOS_PAGO as readonly string[]).includes(medioRaw) ? (medioRaw as MedioPago) : undefined
    const cobro = await marcarCobroPagado(id, medio)
    if (!cobro) return NextResponse.json({ error: 'Cobro no encontrado' }, { status: 404 })

    let boletaId = ''
    let notaCreditoId = ''
    let avisoDte = ''
    if (esDevolucion(cobro.tipo) && cobro.cliente_id) {
      // La devolución YA se transfirió: el cierre no se revierte aunque el SII
      // falle. Si la NC no sale, se avisa acá y por WhatsApp al admin para
      // emitirla a mano — pero el banner desaparece igual.
      const r = await emitirNcDevolucionSiCorresponde(cobro, { creadoPorId: usuario?.id, creadoPorNombre: usuario?.name })
      if (r.nota_credito_id) notaCreditoId = r.nota_credito_id
      else if (r.error) avisoDte = `La devolución quedó cerrada, pero la nota de crédito no se emitió: ${r.error} Emítela a mano desde Facturación.`
    } else if (cobro.tipo === 'saldo' && cobro.cliente_id) {
      try {
        const ficha = (await getSheetData('clientes')).find(f => String(f.id) === String(cobro.cliente_id))
        if (ficha && String(ficha.estado_pago || '').toLowerCase() !== 'pagado') {
          // NO se toca `fecha_pago` de la ficha: esa fecha es la del ABONO, lo
          // que pasó por la máquina el día del retiro, y Ventas POS arma el día
          // con ella. Si el SALDO también se cobra con máquina o link, no se
          // mezcla acá: entra a Ventas POS como su PROPIA línea, fechada el día
          // en que se confirmó (ver `cobrosDelProcesador` en lib/facturacion-pos).
          await updateByIdIf('clientes', String(ficha.id), {}, { estado_pago: 'pagado' })
          const r = await emitirBoletaSiCorresponde({ ...ficha, estado_pago: 'pagado' }, { creadoPorNombre: 'Automático (saldo de pago parcial recibido)' })
          if (r.boleta_id) boletaId = r.boleta_id
        }
      } catch (e) { console.warn('[cobros PATCH] cierre de saldo parcial falló:', e) }
    } else if (cobro.cliente_id) {
      // Adicional pedido después / diferencia de peso: boleta por SOLO ese monto.
      const r = await emitirBoletaCobroSiCorresponde(cobro, { creadoPorNombre: `Automático (${cobro.tipo} pagado)` })
      if (r.boleta_id) boletaId = r.boleta_id
    }

    return NextResponse.json({
      ok: true, cobro,
      boleta_id: boletaId || undefined,
      nota_credito_id: notaCreditoId || undefined,
      aviso: avisoDte || undefined,
    })
  } catch (e) {
    console.error('[cobros PATCH]', e)
    return NextResponse.json({ error: 'No se pudo actualizar el cobro.' }, { status: 500 })
  }
}
