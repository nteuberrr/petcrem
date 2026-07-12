import { enviarTextoWhatsapp, enviarPlantillaWhatsapp, renderPlantillaWa, plantillasAprobadas, isWhatsappConfigured, type EnvioResult } from './whatsapp'

/**
 * Avisos de estado del servicio al TUTOR por WhatsApp (retiro confirmado, vamos
 * en camino, certificado emitido). Regla de costo: texto libre PRIMERO (gratis,
 * si la ventana de 24h está abierta — habitual cuando el cliente habló hace poco
 * con el bot) y PLANTILLA aprobada solo como respaldo si Meta rechaza por
 * ventana cerrada. Best-effort: nunca lanza (el aviso es secundario al flujo que
 * lo dispara — correo/operación siguen su curso aunque WhatsApp falle).
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

/**
 * Envía un aviso al cliente: texto libre y, si la ventana está cerrada, la
 * plantilla indicada (si está aprobada en Meta). `plantilla.variables` van
 * posicionales ({{1}}, {{2}}…).
 */
export async function avisarClienteWhatsapp(
  telefono: string,
  textoLibre: string,
  plantilla?: { nombre: string; variables: string[] },
): Promise<AvisoClienteResult> {
  const to = telWhatsapp(telefono)
  if (!to) return { ok: false, error: 'teléfono inválido' }
  if (!isWhatsappConfigured()) return { ok: false, error: 'WhatsApp no configurado' }
  try {
    const r = await enviarTextoWhatsapp(to, textoLibre)
    if (r.ok) return { ...r, via: 'texto', texto: textoLibre }
    if (r.fuera_de_ventana && plantilla && (await plantillasAprobadas()).has(plantilla.nombre)) {
      const rp = await enviarPlantillaWhatsapp(to, plantilla.nombre, plantilla.variables)
      if (rp.ok) return { ...rp, via: 'plantilla', texto: renderPlantillaWa(plantilla.nombre, plantilla.variables) }
      return rp
    }
    return r
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
