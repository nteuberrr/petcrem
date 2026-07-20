/**
 * Feriados nacionales de Chile. Un feriado que cae en día de semana se trata
 * como fin de semana para el recargo "fuera de horario": el retiro tiene recargo
 * durante TODO el día (no solo desde las 18:00). Lo usan lib/adicionales-auto
 * (auto-carga en la ficha) y el agente de WhatsApp (para avisarlo al cotizar).
 *
 * Client-safe: solo datos + funciones puras (sin imports de servidor).
 *
 * ⚠️ REVISAR/ACTUALIZAR una vez al año: los feriados los fija la ley y algunos
 * son movibles (solsticio, feriados trasladables). Mantener aquí los del año en
 * curso y el siguiente.
 */

const FERIADOS: Record<string, string> = {
  // ── 2026 ──
  '2026-01-01': 'Año Nuevo',
  '2026-04-03': 'Viernes Santo',
  '2026-04-04': 'Sábado Santo',
  '2026-05-01': 'Día del Trabajo',
  '2026-05-21': 'Glorias Navales',
  '2026-06-21': 'Día de los Pueblos Indígenas',
  '2026-06-29': 'San Pedro y San Pablo',
  '2026-07-16': 'Virgen del Carmen',
  '2026-08-15': 'Asunción de la Virgen',
  '2026-09-18': 'Independencia Nacional',
  '2026-09-19': 'Glorias del Ejército',
  '2026-10-12': 'Encuentro de Dos Mundos',
  '2026-10-31': 'Día de las Iglesias Evangélicas',
  '2026-11-01': 'Día de Todos los Santos',
  '2026-12-08': 'Inmaculada Concepción',
  '2026-12-25': 'Navidad',
  // ── 2027 ──
  '2027-01-01': 'Año Nuevo',
  '2027-03-26': 'Viernes Santo',
  '2027-03-27': 'Sábado Santo',
  '2027-05-01': 'Día del Trabajo',
  '2027-05-21': 'Glorias Navales',
  '2027-06-21': 'Día de los Pueblos Indígenas',
  '2027-06-28': 'San Pedro y San Pablo',
  '2027-07-16': 'Virgen del Carmen',
  '2027-08-15': 'Asunción de la Virgen',
  '2027-09-18': 'Independencia Nacional',
  '2027-09-19': 'Glorias del Ejército',
  '2027-10-11': 'Encuentro de Dos Mundos',
  '2027-10-31': 'Día de las Iglesias Evangélicas',
  '2027-11-01': 'Día de Todos los Santos',
  '2027-12-08': 'Inmaculada Concepción',
  '2027-12-25': 'Navidad',
}

/** Normaliza a YYYY-MM-DD (toma los primeros 10 chars). */
function iso10(fecha: string | undefined): string {
  return (fecha || '').trim().slice(0, 10)
}

/** ¿La fecha (YYYY-MM-DD) es feriado en Chile? */
export function esFeriado(fecha: string | undefined): boolean {
  return iso10(fecha) in FERIADOS
}

/** Nombre del feriado, o '' si no lo es. */
export function nombreFeriado(fecha: string | undefined): string {
  return FERIADOS[iso10(fecha)] || ''
}
