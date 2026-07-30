import { getSheetData } from './datastore'
import { formatDate, formatHora } from './dates'
import { avisarClienteWhatsapp, telWhatsapp } from './whatsapp-avisos'
import { upsertContacto, getOrCreateConversacion, insertarMensaje } from './mensajes'
import { enviarRetiroConfirmadoVet } from './vet-cremacion-mailer'

/**
 * Aviso de que el RETIRO se movió de fecha u hora.
 *
 * El único camino que avisaba un cambio de horario era el del bot (cuando el
 * propio cliente lo pedía). Si el equipo movía el retiro desde la agenda o desde
 * la ficha, no se enteraba nadie: el tutor lo descubría cuando llegaba el chofer
 * a otra hora. Esto cubre ese hueco.
 *
 * Se dispara SOLO cuando el caller lo pide explícitamente (la UI pregunta), para
 * que corregir un dato no le mande mensajes por sorpresa a nadie.
 *  - Ficha de TUTOR → WhatsApp (texto libre; si la ventana de 24h está cerrada,
 *    cae a la plantilla `retiro_confirmado`) + queda registrado en su conversación.
 *  - Ficha de CONVENIO (con `veterinaria_id`) → correo B2B al veterinario.
 *
 * Best-effort: nunca lanza.
 */
export async function avisarCambioDeRetiro(
  ficha: Record<string, string>,
  anterior: { fecha: string; hora: string },
): Promise<{ enviado: boolean; via?: string; motivo?: string }> {
  const mascota = String(ficha.nombre_mascota || '').trim() || 'tu mascota'
  const fecha = formatDate(ficha.fecha_retiro)
  const hora = formatHora(ficha.hora_retiro) || ''
  const cuando = `${fecha}${hora ? ` a las ${hora}` : ''}`
  const antes = anterior.fecha
    ? `${formatDate(anterior.fecha)}${anterior.hora ? ` a las ${formatHora(anterior.hora)}` : ''}`
    : ''

  // ── Retiro de convenio: avisa al veterinario por correo ───────────────────
  const vetId = String(ficha.veterinaria_id || '').trim()
  if (vetId) {
    try {
      const vets = await getSheetData('veterinarios')
      const v = vets.find(x => String(x.id) === vetId)
      if (!v?.correo) return { enviado: false, motivo: 'el veterinario no tiene correo registrado' }
      await enviarRetiroConfirmadoVet({
        email: v.correo,
        vetNombre: v.nombre || '',
        contacto: v.nombre_contacto || '',
        nombreMascota: mascota,
        fecha,
        hora,
        reprogramado: antes || undefined,
      })
      return { enviado: true, via: 'correo al veterinario' }
    } catch (e) {
      console.warn('[aviso-cambio-retiro] correo al vet falló:', e)
      return { enviado: false, motivo: 'no se pudo enviar el correo al veterinario' }
    }
  }

  // ── Retiro de tutor: WhatsApp ─────────────────────────────────────────────
  const tel = telWhatsapp(ficha.telefono)
  if (!tel) return { enviado: false, motivo: 'la ficha no tiene un WhatsApp válido' }
  const tutor = String(ficha.nombre_tutor || '').trim().split(/\s+/)[0] || '👋'
  const texto =
    `Hola ${tutor}, te escribimos del Crematorio Alma Animal para avisarte un cambio en el retiro de ${mascota}: ` +
    `quedó para el *${cuando}*${antes ? ` (antes era el ${antes})` : ''}.\n\n` +
    `Si esa hora no te acomoda, respóndenos por aquí y lo reprogramamos 🐾`
  const r = await avisarClienteWhatsapp(tel, texto, {
    nombre: 'retiro_confirmado',
    variables: [tutor, mascota, `el ${cuando}`],
  })
  // Queda en el inbox para que el equipo vea lo que recibió la persona.
  if (r.ok) {
    try {
      const cont = await upsertContacto({ wa_id: tel, telefono: tel, audiencia: 'A' })
      const conv = await getOrCreateConversacion(cont.id, 'whatsapp', cont.audiencia, 'whatsapp')
      await insertarMensaje({
        conversacion_id: conv.id, direccion: 'saliente', cuerpo: r.texto || texto,
        tipo: 'texto', estado: 'enviado', enviado_por: 'sistema',
      })
    } catch (e) { console.warn('[aviso-cambio-retiro] no se pudo registrar en el inbox:', e) }
  }
  return r.ok
    ? { enviado: true, via: r.via === 'plantilla' ? 'WhatsApp (plantilla)' : 'WhatsApp' }
    : { enviado: false, motivo: r.error || 'no se pudo enviar el WhatsApp' }
}
