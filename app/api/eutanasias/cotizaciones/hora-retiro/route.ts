import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, updateByIdIf } from '@/lib/datastore'
import { verifyToken } from '@/lib/eutanasia-tokens'
import { isWhatsappConfigured, avisarAdminsWhatsapp, enviarTextoWhatsapp } from '@/lib/whatsapp'
import { formatDate, formatDateForSheet } from '@/lib/dates'
import { retiroTrasEutanasia, fueraDeVentanaRetiro, conflictosEnAgenda, describirConflictos } from '@/lib/agenda'
import { esFueraDeHorario } from '@/lib/adicionales-auto'
import { recargoEutanasiaPara, getRecargoFueraHorario } from '@/lib/eutanasia-precios'
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

    // La hora que informa el vet es la que ACORDÓ CON LA FAMILIA (así se la pide
    // el correo: "apenas coordines la hora de la visita, infórmanosla"), o sea la
    // hora REAL del servicio. Por eso se guarda también en `hora_servicio` y no
    // solo en `hora_retiro_crematorio`: si no, la ficha, la agenda y el recargo
    // fuera de horario se quedan con la hora que eligió el bot al agendar
    // (caso Gasparín 2026-07-28: la vet coordinó 20:30 y el sistema seguía
    // mostrando las 17:30). Update PARCIAL por id: no reescribe el resto de la fila.
    const horaAnterior = (c.hora_servicio || '').trim()
    // Nuestro RETIRO se agenda 30 min después del procedimiento (dueño 2026-07-28):
    // el vet informa la hora de la eutanasia y el chofer pasa a buscarla enseguida.
    // Si esa media hora ya está topada por otro retiro, se corre al primer hueco
    // hábil (dueño 2026-08-05) — antes se guardaba encimada y la ruta del chofer
    // quedaba imposible. `e{id}` se excluye para que no se bloquee a sí misma.
    const retiro = await retiroTrasEutanasia(c.fecha_servicio, hora, { excluirAgendaId: `e${c.id}` })
    const horaRetiro = retiro.hora
    await updateByIdIf(SHEET_COTI, c.id, {}, { hora_servicio: hora, hora_retiro_crematorio: horaRetiro })

    // La ficha de cremación queda con esa misma hora de retiro (nace del
    // agendamiento sin fecha/hora propias): así el equipo la ve en la ficha y el
    // recargo fuera de horario se calcula con la hora real del retiro.
    if (c.cliente_id) {
      try {
        await updateByIdIf('clientes', String(c.cliente_id), {}, {
          fecha_retiro: formatDateForSheet(c.fecha_servicio) || String(c.fecha_servicio || ''),
          hora_retiro: horaRetiro,
        })
      } catch (e) { console.warn('[hora-retiro] no se pudo actualizar la ficha:', e) }
    }

    // ¿El retiro que queda agendado CHOCA con otra reserva? Esta hora la fija el
    // veterinario tras coordinar con la familia, así que NO se rechaza — pero
    // hasta ahora el choque entraba mudo y la ruta del chofer quedaba imposible
    // (28-07: dos eutanasias quedaron a 30 min de retiros ya agendados). Se
    // guarda igual y se le avisa al equipo con nombre y hora del cruce.
    let alertaChoque = ''
    try {
      const choques = await conflictosEnAgenda(c.fecha_servicio, horaRetiro, `e${c.id}`)
      if (choques.length > 0) {
        alertaChoque = `\n\n⚠️ *OJO: choca con la agenda* — ${describirConflictos(choques)}. ` +
          `Dejamos menos de 45 min entre servicios: revisa la ruta del chofer y reordena o avisa.`
      }
    } catch (e) { console.warn('[hora-retiro] no se pudo revisar choques de agenda:', e) }

    if (isWhatsappConfigured()) {
      try {
        await avisarAdminsWhatsapp(
          `🕒 *Hora coordinada por el veterinario* (Eutanasia N° ${c.id})\n\n` +
          `Mascota: ${c.mascota_nombre}\nTutor: ${c.cliente_nombre}\n` +
          `Vet: ${c.vet_nombre_asignado || '—'}\n` +
          `Eutanasia: ${formatDate(c.fecha_servicio)} *${hora}*` +
          (horaAnterior && horaAnterior !== hora ? ` (antes ${horaAnterior})` : '') + '\n' +
          `*Retiro agendado a las ${horaRetiro}*` +
          (retiro.desplazado ? ` (corrido: a las ${retiro.base} la agenda estaba topada)` : ' (30 min después)') +
          ` · ${c.direccion}, ${c.comuna}` +
          (retiro.sinHueco ? `\n⚠ No quedaba ningún horario libre después de las ${retiro.base}: quedó encimado, revisa la ruta.` : '') +
          (fueraDeVentanaRetiro(horaRetiro) ? '\n⚠ El retiro queda fuera de la ventana habitual (hasta las 21:10): coordínalo a mano.' : '') +
          alertaChoque)
      } catch (e) { console.warn('[hora-retiro] aviso admin falló:', e) }
    }

    // Aviso al CLIENTE (solo si la ficha lleva cremación: sin ella no hay retiro).
    // Se manda UN solo mensaje que cubre los dos motivos, para no escribirle dos
    // veces seguidas:
    //   · el RETIRO se corrió porque su media hora estaba topada — el tutor tiene
    //     que saber a qué hora pasamos de verdad, no la teórica (dueño 2026-08-05)
    //   · aparece el recargo por fuera de horario, para que no sorprenda al cobrar
    try {
      const sinCremacion = (c.tipo_servicio_cremacion || '').toUpperCase() === 'NINGUNA'
      const waCliente = (c.cliente_wa_id || c.cliente_telefono || '').replace(/\D/g, '')
      // El recargo es UNO SOLO por atención (la lleve la eutanasia o el retiro de
      // la cremación) y solo se avisa si APARECE con la hora nueva: si la atención
      // ya lo llevaba, no hay nada nuevo que contar — avisarlo igual le sonaba al
      // cliente a $20.000.
      const montoRecargo = await getRecargoFueraHorario().catch(() => 0)
      const llevaRecargo = (horaEut: string, horaRet: string) =>
        recargoEutanasiaPara(c.fecha_servicio, horaEut, montoRecargo) > 0 || esFueraDeHorario(c.fecha_servicio, horaRet)
      const recargoAntes = llevaRecargo(horaAnterior, (c.hora_retiro_crematorio || '').trim())
      const recargoAhora = llevaRecargo(hora, horaRetiro)
      const avisaRecargo = !recargoAntes && recargoAhora
      if (!sinCremacion && waCliente && (avisaRecargo || retiro.desplazado) && isWhatsappConfigured()) {
        const tutor = (c.cliente_nombre || '').trim().split(/\s+/)[0] || '👋'
        const mascota = c.mascota_nombre && c.mascota_nombre !== 'No Especificado' ? c.mascota_nombre : 'tu mascota'

        let msg = `Hola ${tutor}, la veterinaria nos informó que la hora del servicio de ${mascota} quedó coordinada para las ${hora} hrs. `
        msg += retiro.desplazado
          // El "por qué" importa: si no, suena a que llegamos tarde por desidia.
          ? `Nosotros pasamos a retirarla a las ${horaRetiro} hrs — a las ${retiro.base} ya teníamos otro retiro comprometido, así que la tomamos en el primer horario libre después del procedimiento. `
          : `Nosotros pasamos a retirarla a las ${horaRetiro} hrs. `

        if (avisaRecargo) {
          const otros = await getSheetData('otros_servicios').catch(() => [])
          const fh = otros.find(s => (s.auto_regla || '') === 'fuera_horario' && String(s.activo || '').toUpperCase() === 'TRUE')
          const monto = fh ? (parseInt(fh.precio, 10) || 0) : 10000
          const dSem = new Date(`${c.fecha_servicio}T12:00:00`).getDay()
          const motivo = esFeriado(c.fecha_servicio) ? `por ser feriado (${nombreFeriado(c.fecha_servicio)})`
            : (dSem === 0 || dSem === 6) ? 'por ser fin de semana'
            : 'por ser después de las 18:00'
          msg += `Por ese horario se suma un recargo de ${fmtPrecio(monto)} por fuera de horario (${motivo}), una sola vez ` +
            `(queda especificado en nuestra web). Te lo comentamos para que no sea una sorpresa al momento del cobro. `
        }

        msg += `Cualquier duda, quedamos atentos por aquí 🐾 — Crematorio Alma Animal`
        await enviarTextoWhatsapp(waCliente, msg)
      }
    } catch (e) { console.warn('[hora-retiro] aviso al cliente falló:', e) }

    return NextResponse.json({ ok: true, hora, hora_retiro: horaRetiro, mascota_nombre: c.mascota_nombre })
  } catch (e) {
    console.error('[eutanasias/hora-retiro] error:', e)
    return NextResponse.json({ ok: false, error: 'Error procesando la hora.' }, { status: 500 })
  }
}
