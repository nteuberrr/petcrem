import { getSheetData, appendRow, getNextId, deleteById, updateByIdIf } from './datastore'

/**
 * PRECIOS ESPECIALES INDEXADOS A UNA TABLA BASE.
 *
 * Al duplicar una tabla a los precios ESPECIALES de una veterinaria (Configuración →
 * Precios → Especiales → Duplicar) se puede dejar la copia VIVA: si mañana cambian
 * los precios generales (o los de convenio), los tramos de esa veterinaria se
 * re-copian solos. Sin indexar, la copia es una foto y se edita a mano.
 *
 * Se guarda en `veterinarios.precios_indexados`: '' | 'general' | 'convenio'.
 * Los tramos siguen viviendo en `precios_especiales`, así que TODO el motor de
 * precios (que ya resuelve "si el vet tiene filas especiales, esas mandan") funciona
 * sin cambios y la tabla queda visible y auditable en Configuración.
 *
 * Caso de uso principal: los vets de comisión (Descuentos Convenios), a los que se
 * les cobra al tutor el precio de lista → van indexados a GENERAL.
 *
 * ⚠️ Los tramos de una vet indexada NO se editan a mano: la próxima sincronización
 * los pisa. Para darle tarifa propia hay que quitarle el indexado.
 */

export type OrigenIndexado = 'general' | 'convenio'

const HOJA: Record<OrigenIndexado, string> = {
  general: 'precios_generales',
  convenio: 'precios_convenio',
}

export const ETIQUETA_ORIGEN: Record<OrigenIndexado, string> = {
  general: 'precios generales',
  convenio: 'precios de convenio',
}

export function esOrigenIndexable(v: unknown): v is OrigenIndexado {
  return v === 'general' || v === 'convenio'
}

const CAMPOS = ['peso_min', 'peso_max', 'precio_ci', 'precio_cp', 'precio_sd'] as const

function mismaTabla(a: Record<string, string>[], b: Record<string, string>[]): boolean {
  if (a.length !== b.length) return false
  const clave = (r: Record<string, string>) => CAMPOS.map(c => String(r[c] ?? '').trim()).join('|')
  const sa = a.map(clave).sort()
  const sb = b.map(clave).sort()
  return sa.every((v, i) => v === sb[i])
}

/** Origen al que está indexada una veterinaria, o null si su tabla es propia. */
export function origenDeVet(vet: Record<string, string> | undefined): OrigenIndexado | null {
  const v = String(vet?.precios_indexados || '').trim()
  return esOrigenIndexable(v) ? v : null
}

/** Mapa veterinaria_id → origen indexado, para pintarlo en la UI. */
export async function mapaIndexados(): Promise<Map<string, OrigenIndexado>> {
  const vets = await getSheetData('veterinarios').catch(() => [] as Record<string, string>[])
  const m = new Map<string, OrigenIndexado>()
  for (const v of vets) {
    const o = origenDeVet(v)
    if (o) m.set(String(v.id), o)
  }
  return m
}

/**
 * Rehace los tramos especiales de una vet como copia exacta de su tabla base.
 * Si ya están iguales no escribe nada (evita rotar ids en cada guardado de precios).
 *
 * Un `getNextId` FRESCO por fila y loop secuencial: calcular ids en JS deja la
 * secuencia identity detrás de max(id) → "duplicate key" en el próximo insert.
 */
export async function copiarTablaBase(veterinariaId: string, origen: OrigenIndexado): Promise<{ cambiado: boolean; tramos: number }> {
  const vid = String(veterinariaId || '').trim()
  if (!vid) return { cambiado: false, tramos: 0 }

  const [base, especiales] = await Promise.all([
    getSheetData(HOJA[origen]),
    getSheetData('precios_especiales').catch(() => [] as Record<string, string>[]),
  ])
  const actuales = especiales.filter(r => String(r.veterinaria_id) === vid)
  if (mismaTabla(actuales, base)) return { cambiado: false, tramos: actuales.length }

  for (const r of actuales) await deleteById('precios_especiales', r.id)

  const ordenados = [...base].sort((a, b) => Number(a.peso_min) - Number(b.peso_min))
  for (const t of ordenados) {
    await appendRow('precios_especiales', {
      id: await getNextId('precios_especiales'),
      veterinaria_id: vid,
      peso_min: String(t.peso_min ?? ''),
      peso_max: String(t.peso_max ?? ''),
      precio_ci: String(t.precio_ci ?? ''),
      precio_cp: String(t.precio_cp ?? ''),
      precio_sd: String(t.precio_sd ?? ''),
    })
  }
  return { cambiado: true, tramos: ordenados.length }
}

/** Deja a la vet indexada a `origen` y le copia la tabla de inmediato. */
export async function activarIndexado(veterinariaId: string, origen: OrigenIndexado): Promise<{ tramos: number }> {
  const vid = String(veterinariaId || '').trim()
  if (!vid) throw new Error('Falta la veterinaria.')
  const r = await copiarTablaBase(vid, origen)
  await updateByIdIf('veterinarios', vid, {}, { precios_indexados: origen, tipo_precios: 'precios_especiales' })
  return { tramos: r.tramos }
}

/** Le saca el indexado: los tramos copiados quedan como su tarifa propia, editable. */
export async function desactivarIndexado(veterinariaId: string): Promise<void> {
  const vid = String(veterinariaId || '').trim()
  if (!vid) return
  await updateByIdIf('veterinarios', vid, {}, { precios_indexados: '' })
}

/**
 * Propaga un cambio de una tabla base a todas las vets indexadas a ella. La llama el
 * endpoint de precios después de crear/editar/borrar un tramo. Best-effort: nunca
 * debe romper el guardado de precios (se loguea y sigue).
 */
export async function sincronizarPreciosIndexados(origen: OrigenIndexado): Promise<{ vets: number; actualizados: number }> {
  const indexados = await mapaIndexados()
  const ids = Array.from(indexados.entries()).filter(([, o]) => o === origen).map(([vid]) => vid)
  let actualizados = 0
  for (const vid of ids) {
    try {
      const r = await copiarTablaBase(vid, origen)
      if (r.cambiado) actualizados++
    } catch (e) {
      console.warn(`[precios-indexados] no se pudo sincronizar la veterinaria ${vid}:`, e)
    }
  }
  return { vets: ids.length, actualizados }
}
