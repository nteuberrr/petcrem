import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, updateRow } from '@/lib/datastore'
import { verifyToken } from '@/lib/eutanasia-tokens'
import { isWhatsappConfigured, avisarAdminsWhatsapp, enviarTextoWhatsapp } from '@/lib/whatsapp'
import { formatDate } from '@/lib/dates'
import { esFueraDeHorario } from '@/lib/adicionales-auto'
import { esFeriado, nombreFeriado } from '@/lib/feriados'
import { fmtPrecio } from '@/lib/format'

const SHEET_COTI = 'cotizaciones_eutanasia'

/**
 * POST /api/eutanasias/cotizaciones/hora-retiro
 * body: { token, hora }
 *
 * Endpoint PÚBLICO. El VETERINARIO llega desde el link del correo de coordinación
 * ("infórmanos la hora acordada con el cliente para coordinar el retiro del
 * crematorio"). Guarda `hora_retiro_crematorio` en la cotización → el dashboard
 * la muestra como 2ª hora en la etiqueta de esa eutanasia. Se puede reenviar
 * (el vet corrige la hora). Token HMAC (accion='informar_hora_retiro').
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
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(hora)) {
      return NextResponse.json({ ok: false, error: 'Indica una hora válida (formato HH:MM).' }, { status: 400 })
    }

    const cotis = await getSheetData(SHEET_COTI)
    const idx = cotis.findIndex(r => r.id === verif.payload!.cotizacion_id)
    if (idx === -1) return NextResponse.json({ ok: false, error: 'Solicitud no encontrada.' }, { status: 404 })
    const c = cotis[idx]
    if (c.estado === 'cancelada') {
      return NextResponse.json({ ok: false, error: 'Esta solicitud fue cancelada.' })
    }

    await updateRow(SHEET_COTI, idx, { ...c, hora_retiro_crematorio: hora })

    if (isWhatsappConfigured()) {
      try {
        await avisarAdminsWhatsapp(
          `🕒 *Hora de retiro informada por el veterinario* (Eutanasia N° ${c.id})\n\n` +
          `Mascota: ${c.mascota_nombre}\nTutor: ${c.cliente_nombre}\n` +
          `Vet: ${c.vet_nombre_asignado || '—'}\n` +
          `Eutanasia: ${formatDate(c.fecha_servicio)} ${c.hora_servicio || ''}\n` +
          `*Retiro del crematorio a las ${hora}* · ${c.direccion}, ${c.comuna}`)
      } catch (e) { console.warn('[hora-retiro] aviso admin falló:', e) }
    }

    // Si la hora coordinada cae FUERA DE HORARIO y la ficha lleva cremación, le
    // avisamos al CLIENTE del cambio de hora + el recargo de $ por fuera de horario,
    // para que no se sorprenda al cobrar (caso: eutanasia reprogramada a las 19:30).
    try {
      const sinCremacion = (c.tipo_servicio_cremacion || '').toUpperCase() === 'NINGUNA'
      const waCliente = (c.cliente_wa_id || c.cliente_telefono || '').replace(/\D/g, '')
      if (!sinCremacion && waCliente && isWhatsappConfigured() && esFueraDeHorario(c.fecha_servicio, hora)) {
        const otros = await getSheetData('otros_servicios').catch(() => [])
        const fh = otros.find(s => (s.auto_regla || '') === 'fuera_horario' && String(s.activo || '').toUpperCase() === 'TRUE')
        const monto = fh ? (parseInt(fh.precio, 10) || 0) : 10000
        const tutor = (c.cliente_nombre || '').trim().split(/\s+/)[0] || '👋'
        const mascota = c.mascota_nombre && c.mascota_nombre !== 'No Especificado' ? c.mascota_nombre : 'tu mascota'
        const dSem = new Date(`${c.fecha_servicio}T12:00:00`).getDay()
        const motivo = esFeriado(c.fecha_servicio) ? `por ser feriado (${nombreFeriado(c.fecha_servicio)})`
          : (dSem === 0 || dSem === 6) ? 'por ser fin de semana'
          : 'por ser después de las 19:00'
        const msg =
          `Hola ${tutor}, la veterinaria nos informó que la hora del servicio de ${mascota} quedó coordinada para las ${hora} hrs. ` +
          `El retiro para la cremación tiene un recargo adicional de ${fmtPrecio(monto)} por fuera de horario (${motivo}) ` +
          `(queda especificado en nuestra web). Te lo comentamos para que no sea una sorpresa al momento del cobro. ` +
          `Cualquier duda, quedamos atentos por aquí 🐾 — Crematorio Alma Animal`
        await enviarTextoWhatsapp(waCliente, msg)
      }
    } catch (e) { console.warn('[hora-retiro] aviso fuera de horario al cliente falló:', e) }

    return NextResponse.json({ ok: true, hora, mascota_nombre: c.mascota_nombre })
  } catch (e) {
    console.error('[eutanasias/hora-retiro] error:', e)
    return NextResponse.json({ ok: false, error: 'Error procesando la hora.' }, { status: 500 })
  }
}
