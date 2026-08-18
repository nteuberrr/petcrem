import { avisarClienteWhatsapp } from './whatsapp-avisos'

/**
 * Aviso por WhatsApp al TUTOR cuando un veterinario de la red CONFIRMA la
 * eutanasia a domicilio.
 *
 * Vive acá y no dentro de la ruta porque hay DOS caminos que asignan al vet y
 * los dos tienen que avisar igual:
 *  - el vet acepta desde el link firmado del correo (`/api/eutanasias/cotizaciones/aceptar`)
 *  - el admin lo asigna a mano desde el panel (`PATCH /api/eutanasias/cotizaciones/[id]`)
 *
 * Sale por `avisarClienteWhatsapp`: texto libre primero (gratis, con la ventana
 * de 24h abierta) y la plantilla `eutanasia_vet_confirmado` como respaldo. El
 * respaldo importa: el vet suele confirmar horas o días después de que el tutor
 * escribió, así que la ventana casi siempre está cerrada y el texto libre solo
 * habría rebotado.
 *
 * Best-effort — nunca lanza: el aviso es secundario al flujo que lo dispara.
 */
export async function avisarClienteVetConfirmado(args: {
  /** Fila de `cotizaciones_eutanasia` (ya con el vet asignado). */
  c: Record<string, string>
  /** Nombre completo del vet, tal como se le muestra al tutor. */
  vetNombre: string
  vetTelefono?: string
  /** Se aceptan por compatibilidad con los llamadores; ya no se usan (el tutor
   *  no confirma nada — ver la nota más abajo). */
  baseUrl?: string
  vetId?: string
}): Promise<void> {
  const { c, vetNombre, vetTelefono } = args
  // El wa_id manda (la cotización nació del bot); si no, el teléfono que dejó el
  // tutor. Antes solo se miraba el wa_id, así que una cotización cargada a mano
  // por el equipo nunca avisaba por WhatsApp.
  const telefono = c.cliente_wa_id || c.cliente_telefono || ''
  if (!telefono) return

  const tutor = (c.cliente_nombre || '').trim().split(/\s+/)[0] || '👋'
  const mascota = c.mascota_nombre || 'tu mascota'
  const tel9 = (vetTelefono || '').replace(/\D/g, '').slice(-9)
  // NO se le pide al tutor que "confirme" la visita (decisión del dueño
  // 2026-08-17). Quien confirma es el VETERINARIO, y ya lo hizo: pedirle al
  // tutor que confirme algo que no depende de él lo confunde, y al equipo le
  // llegaba un aviso ("el cliente confirmó la visita") que no significaba nada.
  // El link ya no se genera; la página y el endpoint siguen vivos solo por los
  // enlaces que alcanzaron a salir.

  const texto =
    `Buenas noticias 🐾 Un veterinario de nuestra red confirmó la visita para acompañar a ${mascota}.\n\n` +
    `Se pondrá en contacto contigo a la brevedad para coordinar:\n` +
    `${vetNombre}${tel9 ? ` · +56 ${tel9}` : ''}\n\n` +
    `Cualquier duda, escríbenos por aquí.`

  try {
    await avisarClienteWhatsapp(telefono, texto, {
      nombre: 'eutanasia_vet_confirmado',
      variables: [tutor, mascota],
    })
  } catch (e) {
    console.warn('[eutanasia] aviso WhatsApp de vet confirmado falló:', e)
  }
}
