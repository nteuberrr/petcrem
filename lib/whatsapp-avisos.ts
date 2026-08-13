import {
  enviarTextoWhatsapp, enviarPlantillaWhatsapp, enviarPlantillaUrlWhatsapp,
  renderPlantillaWa, plantillasAprobadas, isWhatsappConfigured, PLANTILLAS_WA, type EnvioResult,
} from './whatsapp'
import { ventanaAbiertaPorTelefono } from './mensajes'

/**
 * Avisos de estado del servicio al TUTOR por WhatsApp (retiro confirmado, vamos
 * en camino, certificado emitido, evaluación).
 *
 * ⚠️ LA VENTANA SE CONSULTA ANTES DE ENVIAR. Parece un detalle y era el bug:
 * antes se mandaba texto libre y la plantilla se usaba solo si Meta devolvía el
 * error de «fuera de ventana». Pero con la ventana cerrada Meta responde **200
 * con message_id** y descarta el mensaje —el mismo comportamiento del incidente
 * del 11-08-2026—, así que el respaldo nunca corría y el aviso se perdía en
 * silencio. Y justo los avisos que más importan (ánfora en camino, certificado)
 * caen días después del último mensaje del tutor, o sea con la ventana cerrada.
 *
 * Regla de costo, ahora con la decisión bien tomada: si la ventana está ABIERTA
 * va texto libre (gratis y puede llevar links); si está cerrada va la plantilla
 * aprobada (se paga, pero llega). Ante la duda —no se pudo leer el inbox— se
 * asume cerrada: sale más barato pagar una plantilla que dar por avisado a
 * alguien que no recibió nada.
 *
 * Best-effort: nunca lanza (el aviso es secundario al flujo que lo dispara —
 * correo y operación siguen su curso aunque WhatsApp falle).
 */

export interface AvisoClienteResult extends EnvioResult {
  /** Cómo salió el aviso: texto libre (gratis) o plantilla (con costo). */
  via?: 'texto' | 'plantilla'
  /** El texto que efectivamente recibió la persona (para registrar/loguear). */
  texto?: string
}

/** Teléfono chileno a formato Meta (56XXXXXXXXX); '' si no da los 9 dígitos. */
export function telWhatsapp(telefono: string | undefined | null): string {
  const t = (telefono || '').replace(/\D/g, '').slice(-9)
  return t.length === 9 ? `56${t}` : ''
}

export interface PlantillaAviso {
  nombre: string
  variables: string[]
  /**
   * Sufijo del botón de link, si la plantilla tiene uno (el token del link
   * corto). Es lo que permite que un aviso fuera de la ventana lleve a alguna
   * parte en vez de terminar en «respóndenos por aquí».
   */
  sufijoUrl?: string
}

/**
 * Envía un aviso al cliente por el canal que corresponda según la ventana de 24h.
 * `plantilla.variables` van posicionales ({{1}}, {{2}}…).
 */
export async function avisarClienteWhatsapp(
  telefono: string,
  textoLibre: string,
  plantilla?: PlantillaAviso,
): Promise<AvisoClienteResult> {
  const to = telWhatsapp(telefono)
  if (!to) return { ok: false, error: 'teléfono inválido' }
  if (!isWhatsappConfigured()) return { ok: false, error: 'WhatsApp no configurado' }
  try {
    if (await ventanaAbiertaPorTelefono(to)) {
      const r = await enviarTextoWhatsapp(to, textoLibre)
      if (r.ok) return { ...r, via: 'texto', texto: textoLibre }
      // Se cerró entre la consulta y el envío: sigue al respaldo por plantilla.
      if (!r.fuera_de_ventana || !plantilla) return r
    }
    if (!plantilla) return { ok: false, error: 'ventana de 24h cerrada y sin plantilla de respaldo' }
    if (!(await plantillasAprobadas()).has(plantilla.nombre)) {
      return { ok: false, error: `ventana cerrada y la plantilla ${plantilla.nombre} no está aprobada` }
    }
    const conBoton = !!PLANTILLAS_WA[plantilla.nombre]?.botonUrl
    const rp = conBoton
      ? await enviarPlantillaUrlWhatsapp(to, plantilla.nombre, plantilla.variables, plantilla.sufijoUrl || '')
      : await enviarPlantillaWhatsapp(to, plantilla.nombre, plantilla.variables)
    if (!rp.ok) return rp
    return { ...rp, via: 'plantilla', texto: renderPlantillaWa(plantilla.nombre, plantilla.variables) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
