import { formatDateForSheet, formatHora } from './dates'

/**
 * Fecha (ISO) y minutos del día AHORA en Chile. Igual que `ahoraChile` de
 * lib/agenda, pero acá sin arrastrar imports de servidor: este módulo lo usa
 * también la ficha en el navegador.
 */
export function ahoraEnChile(): { iso: string; min: number } {
  const now = new Date()
  const tz = 'America/Santiago'
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const hhmm = new Intl.DateTimeFormat('es-CL', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
  const [h, m] = hhmm.split(':').map(Number)
  return { iso, min: (h || 0) * 60 + (m || 0) }
}

/**
 * ¿La mascota YA fue retirada?
 *
 * Hasta ahora el sistema lo deducía de "la ficha tiene código y no es borrador",
 * pero registrar la ficha y retirar a la mascota son cosas distintas: el equipo
 * puede dejar la ficha lista antes de que el chofer salga. Cuando eso pasa, todo
 * lo que se apoya en "ya está registrada" se adelanta — el caso Channel
 * (2026-07-28): la ficha se registró una hora antes del retiro y el bot le cobró
 * el adicional por transferencia en vez de dejarlo para el momento del retiro.
 *
 * Regla: si la ficha tiene una fecha/hora de retiro que TODAVÍA no llega, la
 * mascota no ha sido retirada. Sin fecha de retiro (o ya pasada) se asume que sí,
 * que es como se comportaba antes.
 *
 * Es una función PURA (sin imports de servidor): la usan la ficha en el navegador
 * y los handlers del bot.
 */
export function retiroPendiente(
  ficha: { fecha_retiro?: string; hora_retiro?: string },
  ahora: { iso: string; min: number },
): boolean {
  const fecha = formatDateForSheet(ficha.fecha_retiro) || String(ficha.fecha_retiro || '').trim()
  if (!fecha) return false
  if (fecha > ahora.iso) return true
  if (fecha < ahora.iso) return false
  // Mismo día: decide la hora. Sin hora, se asume que ya pasó (comportamiento previo).
  const hhmm = formatHora(ficha.hora_retiro)
  if (!hhmm) return false
  const [h, m] = hhmm.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return false
  return h * 60 + m > ahora.min
}

/** Complemento de `retiroPendiente`: la mascota ya está en nuestras manos. */
export function yaFueRetirada(
  ficha: { codigo?: string; estado?: string; fecha_retiro?: string; hora_retiro?: string },
  ahora: { iso: string; min: number },
): boolean {
  const registrada = String(ficha.codigo || '').trim() !== '' && String(ficha.estado || '').toLowerCase() !== 'borrador'
  return registrada && !retiroPendiente(ficha, ahora)
}
