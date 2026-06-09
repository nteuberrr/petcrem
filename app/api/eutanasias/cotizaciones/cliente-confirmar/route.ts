import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, updateRow } from '@/lib/datastore'
import { verifyToken } from '@/lib/eutanasia-tokens'
import { enviarTextoWhatsapp, isWhatsappConfigured, adminWhatsapp } from '@/lib/whatsapp'
import { formatDate, formatHoraDia } from '@/lib/dates'

const SHEET_COTI = 'cotizaciones_eutanasia'

/**
 * POST /api/eutanasias/cotizaciones/cliente-confirmar
 * body: { token }
 *
 * Endpoint PÚBLICO. El CLIENTE (tutor) llega desde el link "confirma aquí" que
 * recibió por WhatsApp cuando un veterinario tomó su caso. Al confirmar:
 *  - Marca la cotización: cliente_confirmo = TRUE + fecha_cliente_confirmacion.
 *  - Avisa al admin por WhatsApp que el cliente confirmó la visita.
 *
 * Token firmado (HMAC, accion='cliente_confirmar'); el token ES la autenticación.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const token: string = String(body.token ?? '')
    const verif = verifyToken(token)
    if (!verif.ok || !verif.payload) {
      return NextResponse.json({
        ok: false,
        error: verif.error === 'expired' ? 'El enlace ya expiró. Escríbenos por WhatsApp y te ayudamos.' :
               verif.error === 'invalid_signature' ? 'Enlace inválido.' :
               'Enlace inválido o dañado.',
      }, { status: 400 })
    }
    if (verif.payload.accion !== 'cliente_confirmar') {
      return NextResponse.json({ ok: false, error: 'Acción incorrecta para este enlace.' }, { status: 400 })
    }

    const { cotizacion_id } = verif.payload
    const cotis = await getSheetData(SHEET_COTI)
    const idx = cotis.findIndex(r => r.id === cotizacion_id)
    if (idx === -1) return NextResponse.json({ ok: false, error: 'Solicitud no encontrada.' }, { status: 404 })
    const c = cotis[idx]

    if (c.estado === 'cancelada') {
      return NextResponse.json({ ok: false, error: 'Esta solicitud fue cancelada.' })
    }

    const ya = (c.cliente_confirmo ?? '').toUpperCase() === 'TRUE'
    if (!ya) {
      const ahora = new Date().toISOString()
      await updateRow(SHEET_COTI, idx, { ...c, cliente_confirmo: 'TRUE', fecha_cliente_confirmacion: ahora })

      // Avisar al admin por WhatsApp (best-effort).
      if (isWhatsappConfigured()) {
        const msg =
          `✅ *El cliente confirmó la visita de eutanasia* (N° ${c.id})\n\n` +
          `Mascota: ${c.mascota_nombre}\n` +
          `Tutor: ${c.cliente_nombre}${c.cliente_telefono ? ` · +56 ${c.cliente_telefono}` : ''}\n` +
          `Veterinario: ${c.vet_nombre_asignado || '—'}\n` +
          `Fecha: ${formatDate(c.fecha_servicio)} a las ${formatHoraDia(c.hora_servicio)} · ${c.comuna}`
        try { await enviarTextoWhatsapp(adminWhatsapp(), msg) } catch (e) { console.warn('[cliente-confirmar] aviso admin falló:', e) }
      }
    }

    return NextResponse.json({
      ok: true,
      ya_confirmada: ya,
      mascota_nombre: c.mascota_nombre,
      vet_nombre: c.vet_nombre_asignado,
      fecha_servicio: c.fecha_servicio,
      hora_servicio: c.hora_servicio,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[eutanasias/cliente-confirmar] error:', msg)
    return NextResponse.json({ ok: false, error: 'Error procesando tu confirmación.' }, { status: 500 })
  }
}
