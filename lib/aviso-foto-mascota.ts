import { createTutorToken } from './tutor-token'
import { avisarClienteWhatsapp } from './whatsapp-avisos'
import { BASE_PUBLICA } from './whatsapp'

/**
 * «¿Nos mandas una foto de tu mascota?» por WhatsApp, al registrar la ficha.
 *
 * Por qué existe: ese link salía SOLO por correo y fallaba tanto que el guion del
 * bot lo tiene escrito como caso frecuente — «si el link no le funciona: es lo
 * más común, casi siempre porque vencen» → y de ahí se escala a un humano para
 * reenviarlo. Cada uno de esos es un ticket de soporte y, peor, un certificado
 * sin foto o un cuadro Premium que nunca se hizo porque la foto no llegó nunca.
 *
 * Va por WhatsApp porque es el canal que la persona sí mira (el correo cae en
 * spam con frecuencia incómoda en este rubro), y sale gratis cuando el tutor
 * habló con el bot hace poco; si no, va la plantilla con el botón.
 *
 * En Cremación Premium se pide la foto del CUADRO, que es la que tiene una
 * consecuencia física: sin ella no hay cuadro que pintar. La del certificado la
 * puede subir igual desde el correo.
 *
 * Best-effort: nunca lanza. Es un extra sobre el correo de bienvenida, no un
 * reemplazo — el correo lleva los dos links y el código de seguimiento.
 */
export async function avisarFotoMascota(c: {
  id: string | number
  telefono?: string
  nombre_tutor?: string
  nombre_mascota?: string
  codigo_servicio?: string
}): Promise<void> {
  try {
    const tel = (c.telefono || '').trim()
    if (!tel) return
    const esPremium = (c.codigo_servicio || '').toUpperCase() === 'CP'
    const accion = esPremium ? 'subir_foto_cuadro' : 'subir_foto'
    const token = createTutorToken(String(c.id), accion)
    const tutor = (c.nombre_tutor || '').trim().split(/\s+/)[0] || '👋'
    const mascota = (c.nombre_mascota || '').trim() || 'tu mascota'
    const para = esPremium
      ? 'para el cuadro conmemorativo que incluye tu servicio'
      : 'para incluirla en su certificado'
    const link = `${BASE_PUBLICA}/p/${token}`
    await avisarClienteWhatsapp(
      tel,
      `Hola ${tutor}, ya tenemos a ${mascota} con nosotros y estamos preparando su despedida.\n\n`
      + `Si quieres, puedes subir una foto suya ${para} aquí:\n${link}\n\n`
      + `Es opcional y puedes hacerlo hasta el día de la entrega. 🐾`,
      { nombre: 'foto_mascota', variables: [tutor, mascota, para], sufijoUrl: token },
    )
  } catch (e) {
    console.warn('[aviso-foto-mascota]', e instanceof Error ? e.message : e)
  }
}
