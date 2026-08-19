import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/eutanasia-tokens'
import { registrarHoraRetiro } from '@/lib/eutanasia-hora-retiro'
import { getSheetData } from '@/lib/datastore'
import { formatDateForSheet, formatHora } from '@/lib/dates'

/**
 * Endpoint PÚBLICO. El VETERINARIO llega desde el link del correo de coordinación
 * ("infórmanos el día y la hora que acordaste con la familia"). Se puede reenviar
 * (el vet corrige la coordinación). Token HMAC (accion='informar_hora_retiro').
 *
 * GET  ?token=…  → datos actuales de la solicitud, para PRE-LLENAR el formulario.
 * POST { token, fecha?, hora } → registra la coordinación.
 *
 * Todo lo que dispara informar la coordinación (mover el día, reagendar el
 * retiro, actualizar la ficha, avisar choques y avisarle al tutor) vive en
 * lib/eutanasia-hora-retiro, que se comparte con la respuesta por WhatsApp.
 */

const SHEET_COTI = 'cotizaciones_eutanasia'

/** Datos mínimos para pintar el formulario ya prellenado con lo agendado. */
export async function GET(req: NextRequest) {
  try {
    const verif = verifyToken(String(req.nextUrl.searchParams.get('token') ?? ''))
    if (!verif.ok || !verif.payload || verif.payload.accion !== 'informar_hora_retiro') {
      return NextResponse.json({
        ok: false,
        error: verif.error === 'expired' ? 'El enlace ya expiró. Escríbenos y lo coordinamos.' : 'Enlace inválido o dañado.',
      }, { status: 400 })
    }
    const cotis = await getSheetData(SHEET_COTI)
    const c = cotis.find(r => String(r.id) === String(verif.payload!.cotizacion_id))
    if (!c) return NextResponse.json({ ok: false, error: 'Solicitud no encontrada.' }, { status: 404 })
    return NextResponse.json({
      ok: true,
      fecha: formatDateForSheet(c.fecha_servicio),
      hora: formatHora(c.hora_servicio),
      mascota_nombre: c.mascota_nombre || '',
      cancelada: c.estado === 'cancelada',
    })
  } catch (e) {
    console.error('[eutanasias/hora-retiro] GET:', e)
    return NextResponse.json({ ok: false, error: 'Error leyendo la solicitud.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const hora = String(body.hora ?? '').trim()
    // La fecha es opcional en el contrato (WhatsApp solo la manda cuando el vet
    // nombró un día); el formulario la manda siempre, prellenada con la agendada.
    const fecha = String(body.fecha ?? '').trim()
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

    const res = await registrarHoraRetiro({ cotizacionId: verif.payload.cotizacion_id, hora, fecha })
    if (!res.ok) {
      const status = res.motivo === 'no_encontrada' ? 404
        : (res.motivo === 'hora_invalida' || res.motivo === 'fecha_invalida') ? 400
        : 200
      return NextResponse.json({ ok: false, error: res.error }, { status })
    }
    return NextResponse.json({
      ok: true, hora: res.hora, fecha: res.fecha, fecha_cambio: res.fechaCambio,
      hora_retiro: res.horaRetiro, mascota_nombre: res.mascota,
    })
  } catch (e) {
    console.error('[eutanasias/hora-retiro] error:', e)
    return NextResponse.json({ ok: false, error: 'Error procesando la coordinación.' }, { status: 500 })
  }
}
