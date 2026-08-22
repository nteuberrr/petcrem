import { getSheetData } from './datastore'

/**
 * ¿El teléfono corresponde a un VETERINARIO nuestro? Busca en las dos bases de
 * vets: convenio de cremación (`veterinarios`) y red de eutanasias
 * (`vet_convenio_eutanasia`). Match por últimos 9 dígitos. Best-effort.
 *
 * ⚠️ Una clínica tiene VARIOS celulares (dueño 2026-08-22): el veterinario, la
 * recepción, quien esté de turno. Todos escriben desde el suyo y todos son la
 * misma veterinaria. Por eso `veterinarios` guarda además `telefonos_adicionales`
 * y el reconocimiento mira SIEMPRE la lista completa, nunca `telefono` solo — si
 * no, quien escribe desde el número secundario cae como tutor en duelo: el
 * agente lo saluda con un pésame, le cotiza precios de lista que a su convenio no
 * le corresponden y no le agenda el retiro.
 *
 * `telefonosDeVet` es la fuente ÚNICA de "qué números son de este vet".
 */

/** Últimos 9 dígitos, que es como se comparan los números en todo el sistema. */
const tel9 = (s?: string) => (s || '').replace(/\D/g, '').slice(-9)

/**
 * Todos los teléfonos de un vet, normalizados y sin repetir: el principal
 * primero (es al que se le ESCRIBE) y después los adicionales.
 *
 * El campo adicional es texto libre porque lo llena una persona: se acepta
 * cualquier separador razonable (coma, punto y coma, barra, salto de línea) y
 * cada número puede venir como sea (`+56 9 1234 5678`, `912345678`).
 */
export function telefonosDeVet(vet: Record<string, string> | undefined | null): string[] {
  if (!vet) return []
  const crudos = [vet.telefono || '', ...String(vet.telefonos_adicionales || '').split(/[,;/|\n\r]+/)]
  const out: string[] = []
  for (const c of crudos) {
    const t = tel9(c)
    if (t.length === 9 && !out.includes(t)) out.push(t)
  }
  return out
}

/**
 * `setVets` permite pasar un set precomputado (para el backfill masivo, y no
 * releer las tablas por cada teléfono).
 */
export async function telefonosVet(): Promise<Set<string>> {
  const out = new Set<string>()
  try {
    const [vets, vetsEut] = await Promise.all([
      getSheetData('veterinarios').catch(() => [] as Record<string, string>[]),
      getSheetData('vet_convenio_eutanasia').catch(() => [] as Record<string, string>[]),
    ])
    // La red de eutanasias son personas, no clínicas: un solo número. Pasa por el
    // mismo helper igual —sin `telefonos_adicionales` devuelve solo el principal—
    // para no tener dos formas de normalizar un teléfono.
    for (const v of [...vets, ...vetsEut]) {
      for (const t of telefonosDeVet(v)) out.add(t)
    }
  } catch { /* best-effort */ }
  return out
}

export async function esTelefonoVet(telefono: string, set?: Set<string>): Promise<boolean> {
  const t = tel9(telefono)
  if (t.length !== 9) return false
  const s = set ?? await telefonosVet()
  return s.has(t)
}

/**
 * La veterinaria del CONVENIO DE CREMACIÓN dueña de este número, mirando también
 * sus teléfonos adicionales. Solo activas: una dada de baja no debe seguir
 * entrando en modo veterinario.
 */
export async function vetConvenioPorTelefono(telefono: string): Promise<Record<string, string> | null> {
  const t = tel9(telefono)
  if (t.length !== 9) return null
  const vets = await getSheetData('veterinarios').catch(() => [] as Record<string, string>[])
  return vets.find(v => (v.activo ?? '').toUpperCase() !== 'FALSE' && telefonosDeVet(v).includes(t)) ?? null
}

/**
 * ¿Este número ya es de OTRA veterinaria? Lo usa el alta/edición para no dejar
 * el mismo celular en dos fichas: si pasa, el reconocimiento se vuelve ambiguo y
 * el agente saluda al vet equivocado. Devuelve el nombre de la que lo tiene.
 */
export async function telefonoDeOtroVet(
  telefono: string,
  excluirId?: string,
): Promise<{ id: string; nombre: string } | null> {
  const t = tel9(telefono)
  if (t.length !== 9) return null
  const vets = await getSheetData('veterinarios').catch(() => [] as Record<string, string>[])
  const otro = vets.find(v =>
    String(v.id) !== String(excluirId ?? '')
    && (v.activo ?? '').toUpperCase() !== 'FALSE'
    && telefonosDeVet(v).includes(t))
  return otro ? { id: String(otro.id), nombre: String(otro.nombre || '') } : null
}
