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
  // ── 2028 ──
  '2028-01-01': 'Año Nuevo',
  '2028-04-14': 'Viernes Santo',
  '2028-04-15': 'Sábado Santo',
  '2028-05-01': 'Día del Trabajo',
  '2028-05-21': 'Glorias Navales',
  '2028-06-21': 'Día de los Pueblos Indígenas',
  '2028-06-26': 'San Pedro y San Pablo',
  '2028-07-16': 'Virgen del Carmen',
  '2028-08-15': 'Asunción de la Virgen',
  '2028-09-18': 'Independencia Nacional',
  '2028-09-19': 'Glorias del Ejército',
  '2028-10-09': 'Encuentro de Dos Mundos',
  '2028-10-31': 'Día de las Iglesias Evangélicas',
  '2028-11-01': 'Día de Todos los Santos',
  '2028-12-08': 'Inmaculada Concepción',
  '2028-12-25': 'Navidad',
}

/**
 * Último año cargado en la tabla. Si el sistema pasa de acá, los feriados dejan
 * de aplicarse en silencio (y con ellos el recargo de fuera de horario), así que
 * `avisarSiFaltanFeriados` lo grita en los logs para que alguien los cargue.
 */
export const ULTIMO_ANIO_FERIADOS = 2028

/** Loguea una advertencia si el año en curso ya no está cubierto por la tabla. */
export function avisarSiFaltanFeriados(hoyISO: string): void {
  const anio = parseInt(hoyISO.slice(0, 4), 10)
  if (Number.isFinite(anio) && anio >= ULTIMO_ANIO_FERIADOS) {
    console.warn(`[feriados] la tabla llega hasta ${ULTIMO_ANIO_FERIADOS}: carga los feriados de ${anio + 1} en lib/feriados.ts`)
  }
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
