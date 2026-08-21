import { getSheetData, updateByIdIf } from './datastore'
import { formatDate } from './dates'
import { telWhatsapp } from './whatsapp-avisos'
import {
  enviarBotonesWhatsapp, enviarPlantillaBotonesWhatsapp, enviarTextoWhatsapp,
  plantillasAprobadas, isWhatsappConfigured, avisarAdminsWhatsapp,
} from './whatsapp'
import { ventanaAbiertaPorTelefono, upsertContacto, getOrCreateConversacion, insertarMensaje } from './mensajes'
import { boletaAlCliente } from './vet-boleta'

/**
 * EL TUTOR VALIDA LOS DATOS DE SU MASCOTA.
 *
 * Al REGISTRAR la ficha (mismo momento en que se genera el código y salen los
 * correos) se le manda al tutor un WhatsApp con los datos que tenemos y dos
 * botones: «Los datos están bien» / «Hay un dato malo».
 *
 * Existe porque los errores de tipeo se descubrían tarde. La fecha de
 * fallecimiento sobre todo: se enteraban al emitir el certificado o al imprimir
 * la etiqueta con el nombre, cuando ya había que rehacer el trabajo. El único
 * que sabe si el dato está bien es el tutor, así que se le pregunta a él, y en
 * el momento en que corregirlo todavía no cuesta nada.
 *
 * Lo que NO hace: bloquear. Una ficha observada se certifica igual (decisión del
 * dueño 2026-08-20) — frenar la operación por un dato que capaz ya se corrigió
 * sale más caro que el error que evita. Solo queda marcada y a la vista.
 */

/** Estado de la revisión del tutor. '' = todavía no responde. */
export type EstadoValidacion = '' | 'ok' | 'observado'

export function estadoValidacion(ficha: { datos_validados?: string }): EstadoValidacion {
  const v = String(ficha.datos_validados || '').trim().toLowerCase()
  return v === 'ok' || v === 'observado' ? v : ''
}

/** Prefijo del payload de cada botón. El id de la ficha va detrás. */
const BOTON_OK = 'datos_ok'
const BOTON_MAL = 'datos_mal'

/**
 * ¿A esta ficha le pedimos validación?
 *
 * Solo si tiene un WhatsApp válido y el tutor es NUESTRO cliente. Cuando la
 * ficha llega por un veterinario al que le facturamos a él, el tutor es cliente
 * de la clínica —muchas veces ni sabe que existimos— y escribirle de la nada no
 * corresponde. La excepción son los convenios marcados «Boleta al cliente»
 * (lib/vet-boleta): ahí al tutor le cobramos y le boleteamos nosotros, así que
 * la relación es directa (decisión del dueño 2026-08-20).
 */
export async function correspondeValidacion(ficha: Record<string, string>): Promise<boolean> {
  if (!telWhatsapp(ficha.telefono)) return false
  const vetId = String(ficha.veterinaria_id || '').trim()
  if (!vetId) return true
  const vets = await getSheetData('veterinarios').catch(() => [] as Record<string, string>[])
  return boletaAlCliente(vets.find(v => String(v.id) === vetId))
}

/** Los datos que se le muestran, en el mismo orden que la plantilla. */
function datosDeFicha(ficha: Record<string, string>) {
  const s = (k: string) => String(ficha[k] ?? '').trim()
  const tutor = s('nombre_tutor')
  // La entrega va a la dirección de despacho, salvo que sea la misma del retiro.
  const entrega = String(ficha.misma_direccion || '') === 'TRUE'
    ? s('direccion_retiro')
    : (s('direccion_despacho') || s('direccion_retiro'))
  const comuna = s('comuna')
  return {
    primerNombre: tutor.split(/\s+/)[0] || 'hola',
    mascota: s('nombre_mascota') || 'tu mascota',
    especie: s('especie') || '—',
    defuncion: s('fecha_defuncion') ? formatDate(s('fecha_defuncion')) : '—',
    servicio: s('tipo_servicio') || s('codigo_servicio') || '—',
    tutor: tutor || '—',
    entrega: [entrega, comuna].filter(Boolean).join(', ') || '—',
    codigo: s('codigo') || '—',
  }
}

/** El mismo mensaje que la plantilla, para cuando la ventana está abierta. */
function textoLibre(d: ReturnType<typeof datosDeFicha>): string {
  return `Hola ${d.primerNombre}, ya registramos a ${d.mascota} en nuestro sistema.\n\n`
    + 'Estos son los datos que tenemos. ¿Están correctos?\n\n'
    + `*Especie:* ${d.especie}\n`
    + `*Fecha de fallecimiento:* ${d.defuncion}\n`
    + `*Servicio:* ${d.servicio}\n`
    + `*Tutor:* ${d.tutor}\n`
    + `*Dirección de entrega:* ${d.entrega}\n`
    + `*Código:* ${d.codigo}\n\n`
    + 'Si algo no cuadra, avísanos ahora y lo corregimos antes de emitir el certificado.'
}

/** Deja el mensaje en el inbox, para que el equipo vea lo que recibió la persona. */
async function registrarEnInbox(tel: string, cuerpo: string): Promise<void> {
  try {
    const cont = await upsertContacto({ wa_id: tel, telefono: tel, audiencia: 'A' })
    const conv = await getOrCreateConversacion(cont.id, 'whatsapp', cont.audiencia, 'whatsapp')
    await insertarMensaje({
      conversacion_id: conv.id, direccion: 'saliente', cuerpo,
      tipo: 'texto', estado: 'enviado', enviado_por: 'sistema',
    })
  } catch (e) { console.warn('[validacion-datos] no se pudo registrar en el inbox:', e) }
}

/**
 * Le pide al tutor que revise los datos. Best-effort: nunca lanza — el registro
 * de la ficha y sus correos siguen su curso aunque WhatsApp falle.
 *
 * Dos caminos, por costo: con la ventana de 24h ABIERTA va un mensaje
 * interactivo (gratis); cerrada, la plantilla con los mismos botones (se paga,
 * pero llega). La ventana se consulta ANTES de enviar y no se deduce de la
 * respuesta de Meta: con la ventana cerrada Meta responde 200 con message_id y
 * descarta el mensaje, así que el respaldo nunca correría.
 */
export async function pedirValidacionDatos(ficha: Record<string, string>): Promise<{ enviado: boolean; via?: string; motivo?: string }> {
  const tel = telWhatsapp(ficha.telefono)
  if (!tel) return { enviado: false, motivo: 'la ficha no tiene un WhatsApp válido' }
  if (!isWhatsappConfigured()) return { enviado: false, motivo: 'WhatsApp no configurado' }

  const d = datosDeFicha(ficha)
  const cuerpo = textoLibre(d)
  const botones = [
    { id: `${BOTON_OK}:${ficha.id}`, title: 'Los datos están bien' },
    { id: `${BOTON_MAL}:${ficha.id}`, title: 'Hay un dato malo' },
  ]

  try {
    if (await ventanaAbiertaPorTelefono(tel)) {
      const r = await enviarBotonesWhatsapp(tel, cuerpo, botones)
      if (r.ok) { await registrarEnInbox(tel, cuerpo); return { enviado: true, via: 'interactivo' } }
    }
    if (!(await plantillasAprobadas()).has('validar_datos_ficha')) {
      return { enviado: false, motivo: 'la plantilla validar_datos_ficha no está aprobada en Meta' }
    }
    const rp = await enviarPlantillaBotonesWhatsapp(
      tel, 'validar_datos_ficha',
      [d.primerNombre, d.mascota, d.especie, d.defuncion, d.servicio, d.tutor, d.entrega, d.codigo],
      botones.map(b => b.id),
    )
    if (!rp.ok) return { enviado: false, motivo: rp.error || 'no se pudo enviar' }
    await registrarEnInbox(tel, cuerpo)
    return { enviado: true, via: 'plantilla' }
  } catch (e) {
    return { enviado: false, motivo: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * ¿Este payload de botón es una respuesta de validación? Devuelve la ficha y el
 * veredicto, o null si el botón es de otro flujo.
 *
 * ⚠️ Se lee de DOS lugares: `interactive.button_reply.id` (mensaje interactivo,
 * dentro de la ventana) y `button.payload` (quick-reply de la plantilla, fuera).
 * Quien llame tiene que pasarle los dos.
 */
export function leerBotonValidacion(payload: string): { clienteId: string; ok: boolean } | null {
  const m = String(payload || '').match(/^(datos_ok|datos_mal):(\d+)$/)
  if (!m) return null
  return { clienteId: m[2], ok: m[1] === BOTON_OK }
}

/**
 * Procesa la respuesta del tutor: marca la ficha, le contesta y —si observó algo—
 * avisa al equipo. Devuelve `true` si el mensaje ya quedó atendido (para que el
 * webhook no se lo pase además al agente).
 */
export async function procesarBotonValidacion(payload: string, telefono: string): Promise<boolean> {
  const leido = leerBotonValidacion(payload)
  if (!leido) return false

  const clientes = await getSheetData('clientes').catch(() => [] as Record<string, string>[])
  const ficha = clientes.find(c => String(c.id) === leido.clienteId)
  if (!ficha) return false

  const mascota = String(ficha.nombre_mascota || 'tu mascota')
  const ahora = new Date().toISOString()
  await updateByIdIf('clientes', leido.clienteId, {}, {
    datos_validados: leido.ok ? 'ok' : 'observado',
    datos_validados_at: ahora,
  }).catch(e => console.warn('[validacion-datos] no se pudo guardar la validación:', e))

  const tel = telWhatsapp(telefono) || telWhatsapp(ficha.telefono)
  const respuesta = leido.ok
    ? `Gracias por confirmarlo. Dejamos los datos de ${mascota} tal como están y seguimos con su proceso.`
    : `Gracias por avisarnos. Cuéntanos por aquí qué dato hay que corregir de ${mascota} y lo dejamos bien antes de emitir el certificado.`
  if (tel) {
    await enviarTextoWhatsapp(tel, respuesta).catch(e => console.warn('[validacion-datos] no se pudo responder:', e))
    await registrarEnInbox(tel, respuesta)
  }

  if (!leido.ok) {
    // El agente no edita fichas, así que la corrección la hace una persona.
    await avisarAdminsWhatsapp(
      `⚠️ *Datos observados por el tutor*\n\nFicha ${String(ficha.codigo || '#' + ficha.id)} (${mascota})\n`
      + `Tutor: ${String(ficha.nombre_tutor || '—')} · ${String(ficha.telefono || '—')}\n\n`
      + 'Dice que hay un dato malo. Su respuesta llega al inbox: corrígelo en la ficha antes del certificado.',
    ).catch(e => console.warn('[validacion-datos] no se pudo avisar al equipo:', e))
  }
  return true
}
