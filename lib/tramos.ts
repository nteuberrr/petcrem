// ─────────────────────────────────────────────────────────────────────────────
// Resolución de tramo de precio por peso — helper PURO y compartido.
//
// NO importa nada del servidor (datastore / googleapis): es seguro importarlo
// desde componentes de cliente. Es la ÚNICA fuente de la regla de borde, que
// antes estaba duplicada (y divergía) en el dashboard, reportes/ingresos, la
// ficha del cliente, price-calculator y los precios de eutanasia.
//
// Regla de borde canónica (ver CLAUDE.md): los tramos son intervalos (min, max].
// En el límite exacto entre dos tramos gana SIEMPRE el tramo MENOR (ej. 5 kg entre
// 2–5 y 5–10 → 2–5; 15 kg entre 10–15 y 15–25 → 10–15). El tramo de menor peso_min
// (base) incluye su propio mínimo; el de mayor peso_min (tope) cubre cualquier peso
// por encima de la tabla.
// ─────────────────────────────────────────────────────────────────────────────

export type TramoConPeso = {
  peso_min: string | number
  peso_max: string | number
}

/** Parsea un valor numérico de celda (acepta coma decimal). 0 si no es válido. */
export function numTramo(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(',', '.'))
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

/**
 * Encuentra el tramo aplicable a un peso con la regla de borde canónica.
 * Devuelve null si la tabla está vacía o el peso no es válido (≤ 0).
 */
export function findTramo<T extends TramoConPeso>(tabla: T[], peso: number): T | null {
  if (!tabla.length || !Number.isFinite(peso) || peso <= 0) return null
  // Tramo tope = el de mayor peso_min; tramo base = el de menor peso_min.
  let maxMin = -Infinity
  let minMin = Infinity
  let tramoTope: T | null = null
  for (const t of tabla) {
    const min = numTramo(t.peso_min)
    if (min > maxMin) { maxMin = min; tramoTope = t }
    if (min < minMin) minMin = min
  }
  // Por encima del borde superior (o de la tabla) → tramo tope.
  if (tramoTope && peso > maxMin) return tramoTope
  // Intervalos (min, max]: en el borde exacto gana el tramo MENOR (5 kg → 2–5).
  // El tramo base incluye su propio mínimo (no hay tramo debajo que lo cubra).
  for (const t of tabla) {
    const min = numTramo(t.peso_min)
    const max = numTramo(t.peso_max)
    const cumpleMin = min === minMin ? peso >= min : peso > min
    if (cumpleMin && peso <= max) return t
  }
  return null
}

export type TramoConPrecios = {
  precio_ci?: string | number
  precio_cp?: string | number
  precio_sd?: string | number
}

/** Precio del servicio (CI / CP / SD) de un tramo. 0 si no hay tramo. */
export function precioDelTramo(t: TramoConPrecios | null, codigo: string): number {
  if (!t) return 0
  const c = (codigo || 'CI').toUpperCase()
  const k = c === 'CP' ? 'precio_cp' : c === 'SD' ? 'precio_sd' : 'precio_ci'
  return numTramo((t as Record<string, unknown>)[k])
}
