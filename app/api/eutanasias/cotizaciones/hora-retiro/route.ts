import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/eutanasia-tokens'
import { registrarHoraRetiro } from '@/lib/eutanasia-hora-retiro'

/**
 * POST /api/eutanasias/cotizaciones/hora-retiro
 * body: { token, hora }
 *
 * Endpoint PÚBLICO. El VETERINARIO llega desde el link del correo de coordinación
 * ("infórmanos la hora acordada con el cliente para coordinar el retiro del
 * crematorio"). Se puede reenviar (el vet corrige la hora). Token HMAC
 * (accion='informar_hora_retiro').
 *
 * Todo lo que dispara informar la hora (reagendar el retiro, actualizar la ficha,
 * avisar choques y avisarle al tutor) vive en lib/eutanasia-hora-retiro, que
 * comparte con la respuesta por WhatsApp del vet.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const hora = String(body.hora ?? '').trim()
    const verif = verifyToken(String(body.token ?? ''))
    if (!verif.ok || !verif.payload) {
      return NextResponse.json({
        ok: false,
        error: verif.error === 'expired' ? 'El enlace ya expiró. Escríbenos y lo coordinamos.' : 'Enlace inválido o dañado.',
      }, { status: 400 })
    }
    if (verif.payload.accion !== 'informar_hora_retiro') {
      return NextResponse.json({ ok: false, error: 'Acción incorrecta para este enlace.' }, { status: 400 })
    }

    const res = await registrarHoraRetiro({ cotizacionId: verif.payload.cotizacion_id, hora })
    if (!res.ok) {
      const status = res.motivo === 'no_encontrada' ? 404 : res.motivo === 'hora_invalida' ? 400 : 200
      return NextResponse.json({ ok: false, error: res.error }, { status })
    }
    return NextResponse.json({ ok: true, hora: res.hora, hora_retiro: res.horaRetiro, mascota_nombre: res.mascota })
  } catch (e) {
    console.error('[eutanasias/hora-retiro] error:', e)
    return NextResponse.json({ ok: false, error: 'Error procesando la hora.' }, { status: 500 })
  }
}
