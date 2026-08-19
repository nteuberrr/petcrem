import { getSheetData, updateByIdIf } from './datastore'
import { isWhatsappConfigured, avisarAdminsWhatsapp, enviarTextoWhatsapp } from './whatsapp'
import { formatDate, formatDateForSheet } from './dates'
import { retiroTrasEutanasia, fueraDeVentanaRetiro, conflictosEnAgenda, describirConflictos } from './agenda'
import { esFueraDeHorario } from './adicionales-auto'
import { recargoEutanasiaPara, getRecargoFueraHorario } from './eutanasia-precios'
import { esFeriado, nombreFeriado } from './feriados'
import { fmtPrecio } from './format'

/**
 * El VET informa la FECHA y la HORA que acordó con la familia — TODO lo que
 * dispara, en un solo lugar.
 *
 * Lo comparten el link firmado del correo (`/api/eutanasias/cotizaciones/
 * hora-retiro`) y la respuesta por WhatsApp del vet (lib/eutanasia-whatsapp).
 * No es "guardar un campo": mueve la fecha y la hora del servicio, reagenda el
 * retiro del crematorio, actualiza la ficha, avisa choques al equipo y le avisa
 * al tutor si el retiro se corrió o si apareció el recargo. Hacerlo a medias por
 * el camino de WhatsApp dejaría la agenda mintiendo.
 *
 * ⚠️ La FECHA también se mueve (dueño 2026-08-18): al coordinar con la familia
 * el veterinario no solo ajusta la hora, a veces el servicio se corre de día
 * (pasó el 18-08). Si solo se guardaba la hora, la eutanasia quedaba agendada el
 * día equivocado y el chofer salía a retirar cuando no correspondía. Cuando la
 * fecha cambia hay que mover TODO con ella: el hueco del retiro se busca en la
 * agenda del día NUEVO y el recargo fuera de horario se re-evalúa (un martes a
 * las 19:00 y un sábado a las 19:00 no cobran lo mismo).
 */

const SHEET_COTI = 'cotizaciones_eutanasia'

export type ResultadoHoraRetiro =
  | {
      ok: true
      hora: string
      horaRetiro: string
      mascota: string
      desplazado: boolean
      /** Fecha vigente del servicio (ISO), haya cambiado o no. */
      fecha: string
      /** true si el vet movió el servicio de día. */
      fechaCambio: boolean
    }
  | { ok: false; error: string; motivo: 'no_encontrada' | 'cancelada' | 'hora_invalida' | 'fecha_invalida' }

/** ¿Es una hora válida "HH:MM" (24h)? */
export function esHoraValida(hora: string): boolean {
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test((hora || '').trim())
}

/** ¿Es una fecha ISO válida "YYYY-MM-DD" (y existe en el calendario)? */
export function esFechaValida(fecha: string): boolean {
  const s = (fecha || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T12:00:00`)
  return !Number.isNaN(d.getTime()) && formatDateForSheet(d) === s
}

export async function registrarHoraRetiro(opts: {
  cotizacionId: string
  /** Hora acordada con la familia, "HH:MM". */
  hora: string
  /**
   * Fecha acordada con la familia, ISO "YYYY-MM-DD". Opcional: si no viene se
   * conserva la que ya tenía la solicitud (por WhatsApp solo llega cuando el vet
   * nombró un día explícitamente).
   */
  fecha?: string
}): Promise<ResultadoHoraRetiro> {
  const hora = String(opts.hora ?? '').trim()
  if (!esHoraValida(hora)) {
    return { ok: false, motivo: 'hora_invalida', error: 'Indica una hora válida (formato HH:MM).' }
  }
  const fechaPedida = String(opts.fecha ?? '').trim()
  if (fechaPedida && !esFechaValida(fechaPedida)) {
    return { ok: false, motivo: 'fecha_invalida', error: 'Indica una fecha válida (formato DD-MM-AAAA).' }
  }

  const cotis = await getSheetData(SHEET_COTI)
  const c = cotis.find(r => String(r.id) === String(opts.cotizacionId))
  if (!c) return { ok: false, motivo: 'no_encontrada', error: 'Solicitud no encontrada.' }
  if (c.estado === 'cancelada') {
    return { ok: false, motivo: 'cancelada', error: 'Esta solicitud fue cancelada.' }
  }

  // La fecha/hora que informa el vet es la que ACORDÓ CON LA FAMILIA (así se la
  // pide el correo: "apenas coordines la visita, infórmanos día y hora"), o sea
  // el momento REAL del servicio. Por eso se guardan en `fecha_servicio` /
  // `hora_servicio` y no solo en `hora_retiro_crematorio`: si no, la ficha, la
  // agenda y el recargo fuera de horario se quedan con lo que eligió el bot al
  // agendar (caso Gasparín 2026-07-28: la vet coordinó 20:30 y el sistema seguía
  // mostrando las 17:30).
  const horaAnterior = (c.hora_servicio || '').trim()
  const fechaAnterior = formatDateForSheet(c.fecha_servicio) || String(c.fecha_servicio || '').trim()
  const fecha = fechaPedida || fechaAnterior
  const fechaCambio = !!fechaPedida && !!fechaAnterior && fechaPedida !== fechaAnterior

  // Nuestro RETIRO se agenda 30 min después del procedimiento (dueño 2026-07-28):
  // el vet informa la hora de la eutanasia y el chofer pasa a buscarla enseguida.
  // Si esa media hora ya está topada por otro retiro, se corre al primer hueco
  // hábil (dueño 2026-08-05) — antes se guardaba encimada y la ruta del chofer
  // quedaba imposible. `e{id}` se excluye para que no se bloquee a sí misma.
  // Si el vet movió el DÍA, el hueco se busca en la agenda del día NUEVO.
  const retiro = await retiroTrasEutanasia(fecha, hora, { excluirAgendaId: `e${c.id}` })
  const horaRetiro = retiro.hora
  await updateByIdIf(SHEET_COTI, c.id, {}, {
    ...(fechaCambio ? { fecha_servicio: fecha } : {}),
    hora_servicio: hora,
    hora_retiro_crematorio: horaRetiro,
  })

  // La ficha de cremación queda con esa misma fecha/hora de retiro (nace del
  // agendamiento sin fecha/hora propias): así el equipo la ve en la ficha y el
  // recargo fuera de horario se calcula con el momento real del retiro.
  if (c.cliente_id) {
    try {
      await updateByIdIf('clientes', String(c.cliente_id), {}, {
        fecha_retiro: fecha,
        hora_retiro: horaRetiro,
      })
    } catch (e) { console.warn('[hora-retiro] no se pudo actualizar la ficha:', e) }
  }

  // ¿El retiro que queda agendado CHOCA con otra reserva? Esta hora la fija el
  // veterinario tras coordinar con la familia, así que NO se rechaza — pero hasta
  // ahora el choque entraba mudo y la ruta del chofer quedaba imposible (28-07:
  // dos eutanasias quedaron a 30 min de retiros ya agendados). Se guarda igual y
  // se le avisa al equipo con nombre y hora del cruce.
  let alertaChoque = ''
  try {
    const choques = await conflictosEnAgenda(fecha, horaRetiro, `e${c.id}`)
    if (choques.length > 0) {
      alertaChoque = `\n\n⚠️ *OJO: choca con la agenda* — ${describirConflictos(choques)}. ` +
        `Dejamos menos de 45 min entre servicios: revisa la ruta del chofer y reordena o avisa.`
    }
  } catch (e) { console.warn('[hora-retiro] no se pudo revisar choques de agenda:', e) }

  if (isWhatsappConfigured()) {
    try {
      await avisarAdminsWhatsapp(
        `🕒 *${fechaCambio ? 'Fecha y hora coordinadas' : 'Hora coordinada'} por el veterinario* (Eutanasia N° ${c.id})\n\n` +
        `Mascota: ${c.mascota_nombre}\nTutor: ${c.cliente_nombre}\n` +
        `Vet: ${c.vet_nombre_asignado || '—'}\n` +
        (fechaCambio ? `⚠️ *CAMBIÓ DE DÍA*: estaba para el ${formatDate(fechaAnterior)}\n` : '') +
        `Eutanasia: *${formatDate(fecha)} ${hora}*` +
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
  // Se manda UN solo mensaje que cubre los tres motivos, para no escribirle
  // varias veces seguidas:
  //   · el servicio se movió de DÍA — es lo primero que tiene que saber
  //   · el RETIRO se corrió porque su media hora estaba topada — el tutor tiene
  //     que saber a qué hora pasamos de verdad, no la teórica (dueño 2026-08-05)
  //   · aparece el recargo por fuera de horario, para que no sorprenda al cobrar
  try {
    const sinCremacion = (c.tipo_servicio_cremacion || '').toUpperCase() === 'NINGUNA'
    const waCliente = (c.cliente_wa_id || c.cliente_telefono || '').replace(/\D/g, '')
    // El recargo es UNO SOLO por atención (la lleve la eutanasia o el retiro de la
    // cremación) y solo se avisa si APARECE con el horario nuevo: si la atención ya
    // lo llevaba, no hay nada nuevo que contar — avisarlo igual le sonaba al cliente
    // a $20.000. Ojo: al cambiar de DÍA el recargo puede aparecer solo (un sábado lo
    // lleva todo el día) o desaparecer, así que se compara día CON día.
    const montoRecargo = await getRecargoFueraHorario().catch(() => 0)
    const llevaRecargo = (f: string, horaEut: string, horaRet: string) =>
      recargoEutanasiaPara(f, horaEut, montoRecargo) > 0 || esFueraDeHorario(f, horaRet)
    const recargoAntes = llevaRecargo(fechaAnterior, horaAnterior, (c.hora_retiro_crematorio || '').trim())
    const recargoAhora = llevaRecargo(fecha, hora, horaRetiro)
    const avisaRecargo = !recargoAntes && recargoAhora
    if (!sinCremacion && waCliente && (avisaRecargo || retiro.desplazado || fechaCambio) && isWhatsappConfigured()) {
      const tutor = (c.cliente_nombre || '').trim().split(/\s+/)[0] || '👋'
      const mascota = c.mascota_nombre && c.mascota_nombre !== 'No Especificado' ? c.mascota_nombre : 'tu mascota'

      let msg = `Hola ${tutor}, la veterinaria nos informó que el servicio de ${mascota} quedó coordinado para `
      msg += fechaCambio
        ? `el *${formatDate(fecha)} a las ${hora} hrs* (antes estaba para el ${formatDate(fechaAnterior)}). `
        : `las ${hora} hrs. `
      msg += retiro.desplazado
        // El "por qué" importa: si no, suena a que llegamos tarde por desidia.
        ? `Nosotros pasamos a retirarla a las ${horaRetiro} hrs — a las ${retiro.base} ya teníamos otro retiro comprometido, así que la tomamos en el primer horario libre después del procedimiento. `
        : `Nosotros pasamos a retirarla a las ${horaRetiro} hrs. `

      if (avisaRecargo) {
        const otros = await getSheetData('otros_servicios').catch(() => [])
        const fh = otros.find(s => (s.auto_regla || '') === 'fuera_horario' && String(s.activo || '').toUpperCase() === 'TRUE')
        const monto = fh ? (parseInt(fh.precio, 10) || 0) : 10000
        const dSem = new Date(`${fecha}T12:00:00`).getDay()
        const motivo = esFeriado(fecha) ? `por ser feriado (${nombreFeriado(fecha)})`
          : (dSem === 0 || dSem === 6) ? 'por ser fin de semana'
          : 'por ser después de las 18:00'
        msg += `Por ese horario se suma un recargo de ${fmtPrecio(monto)} por fuera de horario (${motivo}), una sola vez ` +
          `(queda especificado en nuestra web). Te lo comentamos para que no sea una sorpresa al momento del cobro. `
      }

      msg += `Cualquier duda, quedamos atentos por aquí 🐾 — Crematorio Alma Animal`
      await enviarTextoWhatsapp(waCliente, msg)
    }
  } catch (e) { console.warn('[hora-retiro] aviso al cliente falló:', e) }

  return { ok: true, hora, horaRetiro, mascota: c.mascota_nombre || '', desplazado: !!retiro.desplazado, fecha, fechaCambio }
}
