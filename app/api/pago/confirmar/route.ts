import { NextRequest, NextResponse } from 'next/server'
import { verifyCobroToken } from '@/lib/cobro-token'
import { obtenerCobro, marcarClienteConfirmo } from '@/lib/cobros'
import { getSheetData } from '@/lib/datastore'
import { isWhatsappConfigured, avisarAdminsWhatsapp } from '@/lib/whatsapp'
import { fmtPrecio } from '@/lib/format'

/**
 * POST /api/pago/confirmar  body: { token }
 *
 * Endpoint PÚBLICO. El TUTOR llega desde el botón "confirma tu transferencia"
 * de un correo de cobro (adicional o diferencia). Marca el cobro como
 * cliente_confirmo y avisa al equipo por WhatsApp para que confirme el pago
 * recibido en la ficha. Token HMAC (el token ES la autenticación). Idempotente.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const verif = verifyCobroToken(String(body.token ?? ''))
    if (!verif.ok || !verif.cobro_id) {
      return NextResponse.json({
        ok: false,
        error: verif.error === 'expired' ? 'El enlace ya expiró. Escríbenos por WhatsApp y te ayudamos.' : 'Enlace inválido o dañado.',
      }, { status: 400 })
    }
    const antes = await obtenerCobro(verif.cobro_id)
    if (!antes) return NextResponse.json({ ok: false, error: 'No encontramos este cobro.' }, { status: 404 })
    if (antes.estado === 'pagado') {
      return NextResponse.json({ ok: true, ya: true, mensaje: 'Este pago ya fue confirmado por nuestro equipo. ¡Gracias!' })
    }

    const yaConfirmo = antes.estado === 'cliente_confirmo'
    await marcarClienteConfirmo(verif.cobro_id)

    // Avisar al equipo (solo la primera vez). Best-effort.
    if (!yaConfirmo && isWhatsappConfigured()) {
      try {
        const clientes = await getSheetData('clientes').catch(() => [] as Record<string, string>[])
        const c = clientes.find(r => r.id === antes.cliente_id)
        const quien = c ? `${c.nombre_tutor || ''}${c.nombre_mascota ? ` (${c.nombre_mascota})` : ''}` : `ficha ${antes.cliente_id}`
        await avisarAdminsWhatsapp(
          `💸 *El cliente confirmó el pago* — revisar y confirmar en la ficha\n\n` +
          `${quien}\nConcepto: ${antes.detalle || antes.tipo}\nMonto: ${fmtPrecio(parseInt(antes.monto, 10) || 0)}\n\n` +
          `Verifica la transferencia y aprieta "Confirmar pago" en la ficha para cerrar la cobranza.`)
      } catch (e) { console.warn('[pago/confirmar] aviso admin falló:', e) }
    }

    return NextResponse.json({ ok: true, ya: yaConfirmo, mensaje: '¡Gracias! Registramos que hiciste la transferencia. Nuestro equipo la verificará a la brevedad.' })
  } catch (e) {
    console.error('[pago/confirmar] error:', e)
    return NextResponse.json({ ok: false, error: 'No pudimos procesar tu confirmación.' }, { status: 500 })
  }
}
