import { getSheetData } from './datastore'
import {
  isWhatsappConfigured, enviarPlantillaBotonesWhatsapp, enviarTextoWhatsapp,
  renderPlantillaWa, avisarAdminsWhatsapp,
} from './whatsapp'
import { upsertContacto, getOrCreateConversacion, insertarMensaje, actualizarConversacion } from './mensajes'
import { aceptarCotizacion, rechazarEnvio } from './eutanasia-aceptar'
import { registrarHoraRetiro, esHoraValida } from './eutanasia-hora-retiro'
import { nombreCompletoVet } from './eutanasia-mailer'
import { formatDate, formatHoraDia } from './dates'
import { fmtPrecio } from './format'

/**
 * La coordinación con el veterinario de la red de eutanasias, por WhatsApp.
 *
 * Por qué existe: la invitación es una CARRERA (la toma el primero que confirma)
 * y el correo se ve cuando se ve. El vet no nos escribió antes, así que el primer
 * mensaje va SÍ o SÍ como plantilla aprobada (`eutanasia_solicitud_vet`, con
 * quick-reply). Cuando toca "Puedo tomarla" se abre la ventana de 24h de Meta y
 * de ahí en adelante ya podemos escribirle texto libre: ahí le mandamos los datos
 * de la familia y le pedimos la hora que acuerde.
 *
 * Corre EN PARALELO al correo, no en su reemplazo: el correo sigue siendo el
 * documento (desglose de pago, botones de cierre, datos bancarios).
 *
 * Lo que el vet responde entra por el webhook (app/api/mensajes/webhook) ANTES
 * del agente de clientes — si no, el bot de tutores le contestaría precios de
 * cremación a un veterinario.
 */

const SHEET_COTI = 'cotizaciones_eutanasia'
const PLANTILLA = 'eutanasia_solicitud_vet'

/** Últimos 9 dígitos: así comparamos teléfonos guardados en cualquier formato. */
const tel9 = (s?: string) => (s || '').replace(/\D/g, '').slice(-9)

/** Payload de los quick-reply: `eut_si:<cotizacion>:<vet>` / `eut_no:…`. */
function payloads(cotiId: string, vetId: string): string[] {
  return [`eut_si:${cotiId}:${vetId}`, `eut_no:${cotiId}:${vetId}`]
}

/** Descripción corta de la mascota para la plantilla: "Rocky (perro, 12 kg)". */
function resumenMascota(c: Record<string, string>): string {
  const partes = [c.especie, c.peso ? `${c.peso} kg` : ''].filter(Boolean).join(', ')
  return partes ? `${c.mascota_nombre} (${partes})` : String(c.mascota_nombre || 'la mascota')
}

/**
 * Deja registrado en el inbox lo que se le manda/responde al vet, y marca su
 * conversación como 'veterinario' + 'pausado': el agente de tutores no tiene
 * nada que decirle a un veterinario de la red, y sin la pausa le contestaría
 * cotizaciones de cremación. Best-effort, nunca frena el envío.
 */
async function registrarEnInbox(waId: string, cuerpo: string, direccion: 'entrante' | 'saliente', nombre?: string) {
  try {
    const numero = (waId || '').replace(/\D/g, '')
    if (!numero) return
    const contacto = await upsertContacto({ wa_id: numero, telefono: numero, nombre: nombre || null, audiencia: 'B' })
    const conv = await getOrCreateConversacion(contacto.id, 'whatsapp', 'B', 'whatsapp')
    await insertarMensaje({
      conversacion_id: conv.id, direccion, cuerpo, tipo: 'texto',
      estado: direccion === 'saliente' ? 'enviado' : null,
      enviado_por: direccion === 'saliente' ? 'sistema' : null,
    })
    const etiquetas = Array.from(new Set([...(conv.etiquetas || []), 'pausado']))
    await actualizarConversacion(conv.id, { estado: 'veterinario', etiquetas })
  } catch (e) { console.warn('[eutanasia-wa] no se pudo registrar en el inbox:', e) }
}

/**
 * Invita por WhatsApp a los vets indicados (los que tengan móvil). Devuelve
 * cuántos salieron. Best-effort: el correo ya salió, esto es el empujón rápido.
 */
export async function invitarVetsPorWhatsapp(opts: {
  c: Record<string, string>
  vets: Record<string, string>[]
}): Promise<{ enviados: number; fallidos: number }> {
  const { c, vets } = opts
  if (!isWhatsappConfigured()) return { enviados: 0, fallidos: 0 }

  const variables = (vet: Record<string, string>) => [
    nombreCompletoVet(vet.nombre, vet.apellido) || 'Dr/a.',
    resumenMascota(c),
    String(c.comuna || ''),
    `${formatDate(c.fecha_servicio)} a las ${formatHoraDia(c.hora_servicio)}`,
    fmtPrecio(parseInt(c.precio_snapshot || '0', 10)),
  ]

  let enviados = 0
  let fallidos = 0
  for (const vet of vets) {
    const numero = tel9(vet.telefono)
    if (numero.length !== 9) continue
    const vars = variables(vet)
    const r = await enviarPlantillaBotonesWhatsapp(`56${numero}`, PLANTILLA, vars, payloads(String(c.id), String(vet.id)))
    if (r.ok) {
      enviados++
      await registrarEnInbox(`56${numero}`, renderPlantillaWa(PLANTILLA, vars), 'saliente', nombreCompletoVet(vet.nombre, vet.apellido))
    } else {
      fallidos++
      console.warn(`[eutanasia-wa] invitación a vet ${vet.id} falló:`, r.error)
    }
  }
  return { enviados, fallidos }
}

/**
 * Datos de la familia + petición de la hora. Va por TEXTO LIBRE, que recién se
 * puede usar porque el vet acaba de tocar el botón (eso abre la ventana de 24h).
 */
async function enviarDatosYPedirHora(c: Record<string, string>, vet: Record<string, string>): Promise<void> {
  const numero = tel9(vet.telefono)
  if (numero.length !== 9) return
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${c.direccion}, ${c.comuna}, Chile`)}`
  const msg =
    `✅ Quedó asignada a ti la eutanasia de *${c.mascota_nombre}*. Gracias por tomarla.\n\n` +
    `*Contacta directamente a la familia* para coordinar la visita:\n` +
    `${c.cliente_nombre}\n+56 ${(c.cliente_telefono || '').replace(/\D/g, '')}\n\n` +
    `Mascota: ${resumenMascota(c)}\n` +
    `Dirección: ${c.direccion}, ${c.comuna}\n${mapsUrl}\n` +
    (c.notas ? `Notas: ${c.notas}\n` : '') +
    `Pago al veterinario: ${fmtPrecio(parseInt(c.precio_snapshot || '0', 10))}\n\n` +
    `*Apenas acuerdes la hora con la familia, respóndenos por aquí solo con la hora* (por ejemplo: 18:30). ` +
    `Con esa hora agendamos el retiro del crematorio, que pasa 30 minutos después.\n\n` +
    `Te enviamos también un correo con el detalle y los botones para marcar el resultado de la visita.`
  const r = await enviarTextoWhatsapp(`56${numero}`, msg)
  if (r.ok) await registrarEnInbox(`56${numero}`, msg, 'saliente', nombreCompletoVet(vet.nombre, vet.apellido))
  else console.warn('[eutanasia-wa] no se pudieron enviar los datos al vet:', r.error)
}

/**
 * El vet tocó un quick-reply de la invitación. Devuelve true si consumió el
 * mensaje (no debe seguir al flujo normal del inbox/agente).
 *
 * El payload viaja en `button.payload` (quick-reply de plantilla) o en
 * `interactive.button_reply.id`; leer solo uno dejaba el botón sin efecto.
 */
export async function procesarBotonVetEutanasia(msg: {
  from: string
  button?: { payload?: string }
  interactive?: { button_reply?: { id: string } }
}): Promise<boolean> {
  const accion = msg.interactive?.button_reply?.id || msg.button?.payload || ''
  const m = /^eut_(si|no):(\d+):(\d+)$/.exec(accion)
  if (!m) return false

  const [, tipo, cotiId, vetId] = m
  const numero = `56${tel9(msg.from)}`

  // El botón es nuestro, pero el número tiene que ser el del vet al que se lo
  // mandamos: un payload que llega desde otro teléfono no toma el caso. Se deja
  // seguir al flujo normal (queda registrado en el inbox) en vez de tragárselo.
  const vets = await getSheetData('vet_convenio_eutanasia')
  const vet = vets.find(v => String(v.id) === vetId)
  if (!vet || tel9(vet.telefono) !== tel9(msg.from)) return false

  const nombreVet = nombreCompletoVet(vet.nombre, vet.apellido)
  await registrarEnInbox(numero, tipo === 'si' ? '[tocó "Puedo tomarla"]' : '[tocó "No puedo"]', 'entrante', nombreVet)

  if (tipo === 'no') {
    await rechazarEnvio(cotiId, vetId)
    await enviarTextoWhatsapp(numero, 'Gracias por avisar. Seguimos buscando con el resto de la red 🐾')
    return true
  }

  const res = await aceptarCotizacion({ cotizacionId: cotiId, vetId })
  if (!res.ok) {
    await enviarTextoWhatsapp(numero, res.motivo === 'tomada'
      ? 'Gracias por responder. Otro veterinario ya tomó esta solicitud — te avisamos apenas entre la siguiente 🐾'
      : res.mensaje)
    return true
  }
  if (res.ya_aceptada) {
    await enviarTextoWhatsapp(numero, `Ya la tenías tomada. Contacta a ${res.c.cliente_nombre} al +56 ${(res.c.cliente_telefono || '').replace(/\D/g, '')} y, apenas acuerdes la hora, respóndenos con ella por aquí.`)
    return true
  }

  await enviarDatosYPedirHora(res.c, res.vet)
  try {
    await avisarAdminsWhatsapp(
      `✅ *${nombreVet} tomó la eutanasia N° ${cotiId}* (por WhatsApp)\n\n` +
      `Mascota: ${res.c.mascota_nombre}\nTutor: ${res.c.cliente_nombre}\n` +
      `${formatDate(res.c.fecha_servicio)} ${formatHoraDia(res.c.hora_servicio)} · ${res.c.comuna}\n\n` +
      `Le pedimos la hora que acuerde con la familia.`)
  } catch (e) { console.warn('[eutanasia-wa] aviso al admin falló:', e) }
  return true
}

/**
 * Lee una hora escrita a mano: "18:30", "18.30", "1830", "18 hrs", "6:30 pm",
 * "a las 20". Devuelve "HH:MM" o null si no hay una hora clara.
 *
 * Las horas 1–7 SIN am/pm quedan ambiguas a propósito (¿07:00 o 19:00?): en vez
 * de adivinar se le pregunta al vet. Una eutanasia agendada 12 horas corridas es
 * un servicio perdido, y el retiro del chofer sale detrás de esa hora.
 */
export function parseHoraTexto(texto: string): { hora: string } | { ambigua: number } | null {
  const t = (texto || '').toLowerCase().replace(/\s+/g, ' ').trim()
  if (!t) return null
  // Descarta fechas ("14-08", "14/08") para no leerlas como hora.
  const limpio = t.replace(/\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?/g, ' ')

  const m = /(?:^|[^\d])([0-2]?\d)\s*(?::|\.|h(?:rs?)?\s*)?\s*([0-5]\d)?\s*(am|pm|a\.m\.|p\.m\.)?/.exec(limpio)
  if (!m) return null
  let h = parseInt(m[1], 10)
  const min = m[2] ? parseInt(m[2], 10) : 0
  const sufijo = (m[3] || '').replace(/\./g, '')
  if (!Number.isFinite(h) || h > 23 || min > 59) return null

  if (sufijo === 'pm' && h < 12) h += 12
  else if (sufijo === 'am' && h === 12) h = 0
  else if (!sufijo && h >= 1 && h <= 7) return { ambigua: h }

  return { hora: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` }
}

/**
 * ¿Este número es de un vet con una eutanasia TOMADA y sin hora informada? Es el
 * único estado en que interpretamos su mensaje como la hora del servicio, así
 * que no hace falta guardar nada aparte: el "pendiente" ya está en la cotización.
 */
async function eutanasiaEsperandoHora(telefono: string): Promise<{ c: Record<string, string>; vet: Record<string, string> } | null> {
  const t = tel9(telefono)
  if (t.length !== 9) return null
  const vets = await getSheetData('vet_convenio_eutanasia')
  const vet = vets.find(v => tel9(v.telefono) === t)
  if (!vet) return null
  const cotis = await getSheetData(SHEET_COTI)
  const c = cotis
    .filter(x => String(x.vet_id_asignado) === String(vet.id)
      && (x.estado || '').toLowerCase() === 'aceptada'
      && !(x.hora_retiro_crematorio || '').trim())
    .sort((a, b) => (parseInt(b.id, 10) || 0) - (parseInt(a.id, 10) || 0))[0]
  return c ? { c, vet } : null
}

/**
 * El vet respondió por texto mientras le debíamos la hora de una eutanasia que
 * tomó. Si el mensaje trae una hora, la registra (con TODO lo que eso dispara:
 * reagenda el retiro, actualiza la ficha, avisa al equipo y al tutor). Si no,
 * consume igual el mensaje y se lo pasa al equipo — el agente de tutores no debe
 * responderle a un veterinario.
 *
 * Devuelve true si consumió el mensaje.
 */
export async function procesarTextoVetEutanasia(msg: { from: string; text?: { body: string } }): Promise<boolean> {
  const texto = (msg.text?.body || '').trim()
  if (!texto) return false
  const pend = await eutanasiaEsperandoHora(msg.from)
  if (!pend) return false

  const { c, vet } = pend
  const numero = `56${tel9(msg.from)}`
  const nombreVet = nombreCompletoVet(vet.nombre, vet.apellido)
  await registrarEnInbox(numero, texto, 'entrante', nombreVet)

  const leido = parseHoraTexto(texto)

  if (leido && 'ambigua' in leido) {
    await enviarTextoWhatsapp(numero,
      `Para no equivocarnos: ¿te refieres a las ${String(leido.ambigua).padStart(2, '0')}:00 o a las ${leido.ambigua + 12}:00? ` +
      `Respóndenos con la hora en formato de 24 horas (por ejemplo 19:30) 🐾`)
    return true
  }

  if (!leido || !esHoraValida(leido.hora)) {
    // No es una hora: se lo pasamos al equipo en vez de dejar que le conteste el
    // agente de tutores (le respondería precios de cremación a un veterinario).
    try {
      await avisarAdminsWhatsapp(
        `💬 *Mensaje de ${nombreVet}* (eutanasia N° ${c.id} — ${c.mascota_nombre})\n\n` +
        `"${texto.slice(0, 400)}"\n\n` +
        `Responde desde el inbox: +${numero}. Seguimos esperando la hora del procedimiento.`)
    } catch (e) { console.warn('[eutanasia-wa] no se pudo avisar del mensaje del vet:', e) }
    await enviarTextoWhatsapp(numero, 'Gracias, le paso tu mensaje al equipo y te responden en seguida 🐾')
    return true
  }

  const res = await registrarHoraRetiro({ cotizacionId: String(c.id), hora: leido.hora })
  if (!res.ok) {
    await enviarTextoWhatsapp(numero, res.error)
    return true
  }
  await enviarTextoWhatsapp(numero,
    `Anotado: el procedimiento de ${c.mascota_nombre} queda a las ${res.hora} hrs. ` +
    `Nuestro chofer pasa a retirarla a las ${res.horaRetiro} hrs${res.desplazado ? ' (el horario justo después estaba tomado)' : ''}. ` +
    `Cuando termines la visita, marca el resultado con los botones del correo. Gracias 🐾`)
  return true
}
