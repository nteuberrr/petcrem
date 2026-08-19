import { getSheetData } from './datastore'
import {
  isWhatsappConfigured, enviarPlantillaBotonesWhatsapp, enviarTextoWhatsapp,
  renderPlantillaWa, avisarAdminsWhatsapp,
} from './whatsapp'
import { upsertContacto, getOrCreateConversacion, insertarMensaje, actualizarConversacion } from './mensajes'
import { aceptarCotizacion, rechazarEnvio } from './eutanasia-aceptar'
import { registrarHoraRetiro, esHoraValida } from './eutanasia-hora-retiro'
import { nombreCompletoVet } from './eutanasia-mailer'
import { formatDate, formatDateConDia, formatDateForSheet, formatHoraDia, fechaChileISO } from './dates'
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
 * Deja registrado en el inbox lo que se le manda/responde al vet y marca su
 * conversación como 'veterinario'. Best-effort, nunca frena el envío.
 *
 * ⚠️ NO pausa al agente (dueño 2026-08-18). Antes sí lo hacía —la idea era que el
 * bot de tutores no le contestara precios de cremación a un veterinario—, pero la
 * pausa quedaba puesta PARA SIEMPRE: cuando esa misma vet nos escribía días
 * después para agendar un retiro de su clínica, el agente estaba mudo y el
 * retiro no se agendaba (caso Daniella). Hoy el agente tiene MODO VETERINARIO y
 * sabe que le habla un vet (ver lib/vet-contexto), así que la pausa sobra.
 *
 * Además LIMPIA una pausa vieja, salvo que la conversación esté marcada
 * 'requiere-humano': esa sí la puso alguien del equipo a propósito.
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
    const previas = conv.etiquetas || []
    const etiquetas = previas.includes('requiere-humano') ? previas : previas.filter(t => t !== 'pausado')
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
    `*Apenas acuerdes la visita con la familia, respóndenos por aquí con la hora* (por ejemplo: 18:30). ` +
    `Si además quedó para otro día, dinos la fecha (por ejemplo: 20/08 a las 18:30). ` +
    `Con eso agendamos el retiro del crematorio, que pasa 30 minutos después.\n\n` +
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

  if (tipo === 'no') await declinarInvitacion(cotiId, vetId, numero)
  else await tomarInvitacion(cotiId, vetId, numero, nombreVet)
  return true
}

/**
 * El vet TOMA la solicitud (tocó el botón o lo dijo por texto). Los dos caminos
 * hacen exactamente lo mismo, por eso vive acá y no dentro del handler del botón.
 */
async function tomarInvitacion(cotiId: string, vetId: string, numero: string, nombreVet: string): Promise<void> {
  const res = await aceptarCotizacion({ cotizacionId: cotiId, vetId })
  if (!res.ok) {
    // Perdió la carrera: el mensaje sale de MENSAJE_YA_TOMADA (mismo texto que el
    // link del correo) y cierra prometiendo las próximas — no es un portazo.
    await enviarTextoWhatsapp(numero, res.motivo === 'tomada' ? `${res.mensaje} 🐾` : res.mensaje)
    return
  }
  if (res.ya_aceptada) {
    await enviarTextoWhatsapp(numero, `Ya la tenías tomada. Contacta a ${res.c.cliente_nombre} al +56 ${(res.c.cliente_telefono || '').replace(/\D/g, '')} y, apenas acuerdes la visita, respóndenos con el día y la hora por aquí.`)
    return
  }

  await enviarDatosYPedirHora(res.c, res.vet)
  try {
    await avisarAdminsWhatsapp(
      `✅ *${nombreVet} tomó la eutanasia N° ${cotiId}* (por WhatsApp)\n\n` +
      `Mascota: ${res.c.mascota_nombre}\nTutor: ${res.c.cliente_nombre}\n` +
      `${formatDate(res.c.fecha_servicio)} ${formatHoraDia(res.c.hora_servicio)} · ${res.c.comuna}\n\n` +
      `Le pedimos el día y la hora que acuerde con la familia.`)
  } catch (e) { console.warn('[eutanasia-wa] aviso al admin falló:', e) }
}

/** El vet dice que no puede (botón o texto). */
async function declinarInvitacion(cotiId: string, vetId: string, numero: string): Promise<void> {
  await rechazarEnvio(cotiId, vetId)
  await enviarTextoWhatsapp(numero, 'Gracias por avisar. Seguimos buscando con el resto de la red y te escribimos con la próxima 🐾')
}

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** Suma días a una fecha ISO sin pasar por el reloj local. */
function sumarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/**
 * Lee un DÍA escrito a mano en el mensaje del vet, relativo a `hoyISO` (hoy en
 * Chile): "20/08", "20-08-2026", "el 20 de agosto", "hoy", "mañana", "pasado
 * mañana", "el jueves". Devuelve ISO "YYYY-MM-DD" o null si no nombró ninguno.
 *
 * Existe porque al coordinar con la familia el servicio a veces se corre de DÍA,
 * no solo de hora (dueño 2026-08-18): antes leíamos solo la hora y la eutanasia
 * quedaba agendada el día equivocado. Es deliberadamente conservador —si no hay
 * una señal clara de día devuelve null y se conserva el ya agendado—, y de todas
 * formas el acuse de recibo le repite al vet la fecha completa que quedó, así que
 * un día mal leído se ve en el acto.
 */
export function parseFechaTexto(texto: string, hoyISO: string): string | null {
  const t = (texto || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // sin tildes: "miércoles" → "miercoles"
    .replace(/\s+/g, ' ').trim()
  if (!t) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hoyISO)) return null

  if (/\bpasado\s+manana\b/.test(t)) return sumarDias(hoyISO, 2)
  if (/\bmanana\b/.test(t)) return sumarDias(hoyISO, 1)
  if (/\bhoy\b/.test(t)) return hoyISO

  const anioHoy = Number(hoyISO.slice(0, 4))
  // Arma la fecha eligiendo el año que la deja más cerca de hoy: un "20/08"
  // escrito el 28-12 se refiere al año que viene, no al que termina.
  const armar = (d: number, m: number, anio?: number): string | null => {
    if (!(d >= 1 && d <= 31 && m >= 1 && m <= 12)) return null
    const candidatos = anio
      ? [anio < 100 ? 2000 + anio : anio]
      : [anioHoy, anioHoy + 1, anioHoy - 1]
    let mejor: string | null = null
    let mejorDist = Infinity
    for (const y of candidatos) {
      const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const chk = new Date(`${iso}T12:00:00Z`)
      if (Number.isNaN(chk.getTime()) || chk.toISOString().slice(0, 10) !== iso) continue
      const dist = Math.abs(chk.getTime() - new Date(`${hoyISO}T12:00:00Z`).getTime())
      if (dist < mejorDist) { mejorDist = dist; mejor = iso }
    }
    return mejor
  }

  // "20/08", "20-08-2026" (nunca una hora: "18:30" lleva ':' y no matchea).
  const num = /(?:^|[^\d])(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?(?![\d:])/.exec(t)
  if (num) {
    const iso = armar(Number(num[1]), Number(num[2]), num[3] ? Number(num[3]) : undefined)
    if (iso) return iso
  }

  // "el 20 de agosto"
  const conMes = new RegExp(`(\\d{1,2})\\s*(?:de\\s*)?(${MESES.join('|')})`).exec(t)
  if (conMes) {
    const iso = armar(Number(conMes[1]), MESES.indexOf(conMes[2]) + 1)
    if (iso) return iso
  }

  // "el jueves" → el próximo jueves (hoy cuenta si es ese mismo día).
  const dia = new RegExp(`\\b(${DIAS_SEMANA.join('|')})\\b`).exec(t)
  if (dia) {
    const objetivo = DIAS_SEMANA.indexOf(dia[1])
    const hoyDow = new Date(`${hoyISO}T12:00:00Z`).getUTCDay()
    return sumarDias(hoyISO, (objetivo - hoyDow + 7) % 7)
  }

  return null
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
  // Descarta fechas ("14-08", "14/08", "el 20 de agosto") para no leerlas como hora.
  const limpio = t
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?/g, ' ')
    .replace(new RegExp(`\\d{1,2}\\s*(?:de\\s*)?(?:${MESES.join('|')})`, 'g'), ' ')

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

/** El vet de la red dueño de este número, o null. Primer filtro y el más barato. */
async function vetPorTelefono(telefono: string): Promise<Record<string, string> | null> {
  const t = tel9(telefono)
  if (t.length !== 9) return null
  const vets = await getSheetData('vet_convenio_eutanasia')
  return vets.find(v => tel9(v.telefono) === t) ?? null
}

/**
 * ¿Este vet tiene una eutanasia TOMADA y sin hora informada? Es el único estado
 * en que interpretamos su mensaje como el día/hora del servicio, así que no hace
 * falta guardar nada aparte: el "pendiente" ya está en la cotización.
 *
 * ⚠️ Solo cuenta si el servicio es de HOY o de más adelante (dueño 2026-08-18).
 * Sin ese corte, una eutanasia vieja a la que el vet nunca nos informó la hora
 * dejaba su conversación "esperando hora" para siempre, y los vets que trabajan
 * seguido quedaban con el canal secuestrado: cada mensaje suyo se lo tragaba este
 * handler y el agente no llegaba a verlo (caso Daniella, 18-08: pidió dos retiros
 * de su clínica y ninguno se agendó).
 */
async function eutanasiaEsperandoHora(vet: Record<string, string>): Promise<Record<string, string> | null> {
  const cotis = await getSheetData(SHEET_COTI)
  const ayer = sumarDias(fechaChileISO(), -1)
  return cotis
    .filter(x => String(x.vet_id_asignado) === String(vet.id)
      && (x.estado || '').toLowerCase() === 'aceptada'
      && !(x.hora_retiro_crematorio || '').trim()
      && (formatDateForSheet(x.fecha_servicio) || '') >= ayer)
    .sort((a, b) => (parseInt(b.id, 10) || 0) - (parseInt(a.id, 10) || 0))[0] ?? null
}

/**
 * ¿Este mensaje es la RESPUESTA a "dinos el día y la hora"? Tiene que parecerlo
 * de verdad: corto y sin las marcas de otra cosa.
 *
 * El filtro es la mitad importante del arreglo de arriba. Un veterinario que nos
 * debe una hora igual nos escribe por otras razones —"quiero agendar un retiro
 * de un paciente… Retiro para las 13:00"— y ahí hay una hora perfectamente
 * legible: sin este corte, ese texto se registraba como la hora de la eutanasia
 * y encima le robaba el turno al agente, que era quien tenía que agendar el
 * retiro. Lo largo, con teléfonos, direcciones o palabras de agendamiento, cae
 * al agente (que ya sabe que le habla un vet: lib/vet-contexto).
 */
export function pareceRespuestaDeHora(texto: string): boolean {
  const t = texto.trim()
  if (t.length > 80) return false
  const plano = t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (/\d{7,}/.test(plano)) return false                                    // teléfono
  if (/agendar|solicitar|convenio|tutor|direccion|paciente:|kg\b|cremacion/.test(plano)) return false
  return parseHoraTexto(t) !== null
}

/**
 * ¿Este vet tiene una invitación ABIERTA (cotización todavía en 'enviada' a la
 * que se le mandó la plantilla)? Sirve para leer un "sí puedo" / "no puedo"
 * escrito a mano: no todos tocan el botón, y sin esto esa respuesta se perdía.
 */
async function invitacionAbierta(vet: Record<string, string>): Promise<Record<string, string> | null> {
  const [cotis, envios] = await Promise.all([
    getSheetData(SHEET_COTI),
    getSheetData('cotizaciones_eutanasia_envios').catch(() => [] as Record<string, string>[]),
  ])
  const invitadas = new Set(
    envios.filter(e => String(e.vet_id) === String(vet.id) && (e.estado_envio || '') !== 'rechazada')
      .map(e => String(e.cotizacion_id)),
  )
  return cotis
    .filter(x => (x.estado || '').toLowerCase() === 'enviada' && invitadas.has(String(x.id)))
    .sort((a, b) => (parseInt(b.id, 10) || 0) - (parseInt(a.id, 10) || 0))[0] ?? null
}

/** ¿El vet está diciendo que SÍ la toma? Deliberadamente estrecho. */
function diceQueSi(texto: string): boolean {
  const t = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  if (/\bno\b/.test(t)) return false
  if (/(la|lo)\s+(tomo|puedo tomar)|puedo tomarla|yo la tomo|me la tomo|acepto|cuenta conmigo|voy yo|la agarro/.test(t)) return true
  return t.length <= 25 && /^(si|si puedo|puedo|dale|ok|okey|listo|de acuerdo|perfecto|yo voy|voy)\b/.test(t)
}

/** ¿El vet está diciendo que NO puede? */
function diceQueNo(texto: string): boolean {
  const t = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  if (/^no[.! ]*$/.test(t)) return true
  return /no\s+(puedo|podre|alcanzo|estoy|voy a poder|me acomoda|tengo disponibilidad|estare)/.test(t)
}

/**
 * El vet respondió por TEXTO. Solo DOS cosas se consumen acá:
 *
 *  1. La respuesta a "dinos el día y la hora" de una eutanasia que tomó → se
 *     registra con todo lo que eso dispara (mueve la fecha si la nombró, reagenda
 *     el retiro, actualiza la ficha, avisa al equipo y al tutor).
 *  2. Un "sí puedo" / "no puedo" escrito a mano en vez de tocar el botón de la
 *     invitación → vale exactamente lo mismo que el botón. Sin esto esa respuesta
 *     se perdía y la solicitud quedaba sin tomar.
 *
 * TODO lo demás cae al agente, que sabe que le habla un veterinario
 * (lib/vet-contexto) y puede agendarle el retiro de su clínica. Antes este
 * handler se tragaba CUALQUIER mensaje de un vet con una hora pendiente y le
 * respondía "le paso tu mensaje al equipo": los vets que trabajan seguido casi
 * siempre tienen una pendiente, así que el agente no volvía a atenderlos nunca
 * (caso Daniella, 18-08: dos pedidos de retiro sin agendar).
 *
 * Devuelve true si consumió el mensaje.
 */
export async function procesarTextoVetEutanasia(msg: { from: string; text?: { body: string } }): Promise<boolean> {
  const texto = (msg.text?.body || '').trim()
  if (!texto) return false
  const numero = `56${tel9(msg.from)}`

  // El teléfono se resuelve PRIMERO y con una sola lectura: por acá pasa cada
  // mensaje entrante del sistema y la inmensa mayoría son de tutores.
  const vet = await vetPorTelefono(msg.from)
  if (!vet) return false
  const nombreVet = nombreCompletoVet(vet.nombre, vet.apellido)

  const leido = pareceRespuestaDeHora(texto) ? parseHoraTexto(texto) : null
  const c = leido ? await eutanasiaEsperandoHora(vet) : null

  if (!leido || !c) {
    // Respuesta escrita a la invitación (el que no toca el botón). Solo se mira
    // la base si el texto ya parece un sí/no: cualquier otra cosa es del agente.
    const si = diceQueSi(texto)
    const no = !si && diceQueNo(texto)
    if (!si && !no) return false
    const inv = await invitacionAbierta(vet)
    if (!inv) return false
    await registrarEnInbox(numero, texto, 'entrante', nombreVet)
    if (si) await tomarInvitacion(String(inv.id), String(vet.id), numero, nombreVet)
    else await declinarInvitacion(String(inv.id), String(vet.id), numero)
    return true
  }

  await registrarEnInbox(numero, texto, 'entrante', nombreVet)

  if ('ambigua' in leido) {
    await enviarTextoWhatsapp(numero,
      `Para no equivocarnos: ¿te refieres a las ${String(leido.ambigua).padStart(2, '0')}:00 o a las ${leido.ambigua + 12}:00? ` +
      `Respóndenos con la hora en formato de 24 horas (por ejemplo 19:30) 🐾`)
    return true
  }
  if (!esHoraValida(leido.hora)) return false

  // El DÍA también puede haberse movido al coordinar con la familia: si el vet lo
  // nombra, se toma; si no dice nada, se conserva el agendado (parseFechaTexto
  // devuelve null y registrarHoraRetiro no lo toca).
  const fecha = parseFechaTexto(texto, fechaChileISO()) || undefined
  const res = await registrarHoraRetiro({ cotizacionId: String(c.id), hora: leido.hora, fecha })
  if (!res.ok) {
    await enviarTextoWhatsapp(numero, res.error)
    return true
  }
  // El acuse repite la fecha COMPLETA, con día de la semana: es la red de
  // seguridad de la lectura del día — si entendimos mal, el vet lo ve al toque.
  await enviarTextoWhatsapp(numero,
    `Anotado: el procedimiento de ${c.mascota_nombre} queda el *${formatDateConDia(res.fecha)}* a las *${res.hora}* hrs. ` +
    `Nuestro chofer pasa a retirarla a las ${res.horaRetiro} hrs${res.desplazado ? ' (el horario justo después estaba tomado)' : ''}. ` +
    `Si algo de eso no es lo que acordaste, respóndenos y lo corregimos. ` +
    `Cuando termines la visita, marca el resultado con los botones del correo. Gracias 🐾`)
  return true
}
