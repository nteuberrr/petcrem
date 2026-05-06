/**
 * Helpers de días hábiles para el calendario de entregas.
 * Día hábil = lunes a viernes que no sea feriado nacional en Chile.
 *
 * La lista de feriados es estática y debe actualizarse anualmente. Los feriados
 * variables (Pascua, Pueblos Indígenas, etc.) están hardcoded para 2025-2027.
 */

/** Feriados nacionales de Chile en formato YYYY-MM-DD. Actualizar anualmente. */
const FERIADOS_CL = new Set<string>([
  // Fijos cada año
  '2025-01-01', '2025-05-01', '2025-05-21', '2025-06-20', '2025-06-29',
  '2025-07-16', '2025-08-15', '2025-09-18', '2025-09-19', '2025-10-12',
  '2025-10-31', '2025-11-01', '2025-12-08', '2025-12-25',
  '2025-04-18', '2025-04-19', // Viernes y Sábado Santo 2025
  '2025-12-14', // Elecciones presidenciales 2025

  '2026-01-01', '2026-05-01', '2026-05-21', '2026-06-21', '2026-06-29',
  '2026-07-16', '2026-08-15', '2026-09-18', '2026-09-19', '2026-10-12',
  '2026-10-31', '2026-11-01', '2026-12-08', '2026-12-25',
  '2026-04-03', '2026-04-04', // Viernes y Sábado Santo 2026

  '2027-01-01', '2027-05-01', '2027-05-21', '2027-06-21', '2027-06-29',
  '2027-07-16', '2027-08-15', '2027-09-18', '2027-09-19', '2027-09-20',
  '2027-10-12', '2027-10-31', '2027-11-01', '2027-12-08', '2027-12-25',
  '2027-03-26', '2027-03-27', // Viernes y Sábado Santo 2027
])

function isoOf(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** True si la fecha es lunes-viernes y no está en la lista de feriados. */
export function esDiaHabil(d: Date): boolean {
  const dow = d.getDay() // 0 dom, 6 sab
  if (dow === 0 || dow === 6) return false
  return !FERIADOS_CL.has(isoOf(d))
}

/**
 * Devuelve los próximos N días hábiles a partir de una fecha (incluye la fecha
 * inicial si es hábil). Cada elemento es un Date a las 12:00 local.
 */
export function proximosDiasHabiles(desde: Date, cantidad: number): Date[] {
  const out: Date[] = []
  const cursor = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate(), 12, 0, 0)
  while (out.length < cantidad) {
    if (esDiaHabil(cursor)) out.push(new Date(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

/**
 * Suma N días hábiles a una fecha. Útil para calcular fecha límite de entrega
 * desde fecha_retiro: agregarDiasHabiles(fecha_retiro, 3) = 3er día hábil.
 *
 * Si fecha_retiro=lunes, +3 hábiles = jueves.
 * Si fecha_retiro=viernes, +3 hábiles = miércoles.
 *
 * Día 0 es la fecha de retiro misma; cuenta hacia adelante.
 */
export function agregarDiasHabiles(desde: Date, dias: number): Date {
  const cursor = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate(), 12, 0, 0)
  if (dias <= 0) return cursor
  let agregados = 0
  // Avanzamos un día y vamos contando los hábiles, hasta llegar al N
  while (agregados < dias) {
    cursor.setDate(cursor.getDate() + 1)
    if (esDiaHabil(cursor)) agregados += 1
  }
  return cursor
}

export function isoFecha(d: Date): string {
  return isoOf(d)
}
