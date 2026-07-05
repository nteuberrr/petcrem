import { getSheetData } from './datastore'

/**
 * ¿El teléfono corresponde a un VETERINARIO nuestro? Busca en las dos bases de
 * vets: convenio de cremación (`veterinarios`) y red de eutanasias
 * (`vet_convenio_eutanasia`). Match por últimos 9 dígitos. Best-effort.
 *
 * `setVets` permite pasar un set precomputado (para el backfill masivo, y no
 * releer las tablas por cada teléfono).
 */
export async function telefonosVet(): Promise<Set<string>> {
  const out = new Set<string>()
  const norm = (t: string) => (t || '').replace(/\D/g, '').slice(-9)
  try {
    const [vets, vetsEut] = await Promise.all([
      getSheetData('veterinarios').catch(() => [] as Record<string, string>[]),
      getSheetData('vet_convenio_eutanasia').catch(() => [] as Record<string, string>[]),
    ])
    for (const v of vets) { const t = norm(v.telefono || ''); if (t.length === 9) out.add(t) }
    for (const v of vetsEut) { const t = norm(v.telefono || ''); if (t.length === 9) out.add(t) }
  } catch { /* best-effort */ }
  return out
}

export async function esTelefonoVet(telefono: string, set?: Set<string>): Promise<boolean> {
  const tel9 = (telefono || '').replace(/\D/g, '').slice(-9)
  if (tel9.length !== 9) return false
  const s = set ?? await telefonosVet()
  return s.has(tel9)
}
