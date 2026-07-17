import { normalizar } from './comunas'

/**
 * Cobertura geográfica del servicio de retiro/atención a domicilio.
 *
 * `COMUNAS_NO_CUBIERTAS`: comunas de la RM donde NO llegamos con retiro/atención
 * (decisión del negocio). El agente de WhatsApp/IG NO agenda retiros ni eutanasias
 * en estas comunas: informa con amabilidad y escala. Lista ESTABLE (mismo criterio
 * que lib/feriados o lib/diferenciadores: dato de negocio hardcodeado). Si en el
 * futuro cambia seguido, conviene moverla a config editable (empresa_config).
 *
 * El recargo POR DISTANCIA (comunas con cobertura pero lejanas, +$20.000) es OTRA
 * cosa y sí es editable — vive en `otros_servicios` (auto_regla='distancia').
 *
 * Módulo PURO (sin imports de servidor): usable en cliente y servidor.
 */
export const COMUNAS_NO_CUBIERTAS = [
  'Talagante',
  'Melipilla',
  'Pirque',
  'San José de Maipo',
  'Til Til',
] as const

/** Normaliza para comparar: sin tildes, minúsculas y SIN espacios/guiones ("Til Til"→"tiltil"). */
function clave(s: string | undefined | null): string {
  return normalizar(s || '').replace(/[^a-z0-9]/g, '')
}

const CLAVES_NO_CUBIERTAS = new Set(COMUNAS_NO_CUBIERTAS.map(clave))

/** ¿La comuna está FUERA de cobertura (no damos retiro ni atención a domicilio)? */
export function esComunaNoCubierta(comuna: string | undefined | null): boolean {
  const c = clave(comuna)
  return !!c && CLAVES_NO_CUBIERTAS.has(c)
}
