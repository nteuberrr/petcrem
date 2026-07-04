/**
 * LINKS PÚBLICOS de la app que los agentes/generadores pueden usar como CTA
 * (botones de correo, links en captions). FUENTE ÚNICA: si se suma una landing
 * pública nueva, agregarla acá y todos los generadores la conocen.
 */

export function basePublica(): string {
  return (process.env.PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'https://petcrem.vercel.app').replace(/\/+$/, '')
}

/** Bloque para inyectar en los prompts (mailing + agente de marketing). */
export function LINKS_PUBLICOS(): string {
  const base = basePublica()
  return `LINKS PÚBLICOS DE ACCIÓN (los ÚNICOS links de la app que puedes usar en CTAs/botones, según el objetivo de la pieza):
- Inscripción de CLÍNICAS/VETERINARIAS al convenio de CREMACIÓN (la clínica queda inscrita al instante, con tarifas de convenio): ${base}/convenio-veterinarias
- Inscripción de VETERINARIOS a la red de EUTANASIAS a domicilio: ${base}/convenio-eutanasias
- Registro de mascota para TUTORES (autoatención): ${base}/registro-mascota`
}
