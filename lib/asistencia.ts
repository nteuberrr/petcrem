/**
 * Helpers de cálculo de asistencia y horas extra.
 * Las horas se manejan como strings "HH:MM" pero soportan también seriales Excel
 * gracias a horaToMinutos() / formatHora() de lib/dates.ts.
 */
import { horaToMinutos, formatDateForSheet } from '@/lib/dates'

export type JornadaConfig = {
  id: string
  vigente_desde: string // YYYY-MM-DD
  hora_entrada: string  // "HH:MM"
  hora_salida: string   // "HH:MM"
  precio_hora_extra: number
}

/**
 * Devuelve la config vigente para una fecha dada — la última `vigente_desde <= fecha`.
 * Si no hay ninguna, devuelve null.
 */
export function configVigente(configs: JornadaConfig[], fecha: string): JornadaConfig | null {
  const f = formatDateForSheet(fecha)
  if (!f) return null
  const elegibles = configs.filter(c => {
    const vd = formatDateForSheet(c.vigente_desde)
    return vd && vd <= f
  })
  if (elegibles.length === 0) return null
  // Ordenar por vigente_desde descendente y devolver la primera
  elegibles.sort((a, b) => formatDateForSheet(b.vigente_desde).localeCompare(formatDateForSheet(a.vigente_desde)))
  return elegibles[0]
}

/**
 * Calcula minutos trabajados, normales y extra para un fichaje.
 * - Findes: todo cuenta como extra
 * - Día laboral:
 *   - antes de hora_entrada → extra
 *   - después de hora_salida → extra
 *   - rango [hora_entrada, hora_salida] → normal
 *
 * Si los inputs son inválidos devuelve { trabajados: 0, normales: 0, extra: 0 }.
 */
export function calcularMinutos(
  fecha: string,
  horaEntrada: string,
  horaSalida: string,
  config: JornadaConfig,
): { trabajados: number; normales: number; extra: number; esFindesemana: boolean; diaSemana: string } {
  const iso = formatDateForSheet(fecha)
  const d = iso ? new Date(`${iso}T12:00:00`) : null
  const dow = d ? d.getDay() : -1 // 0 dom, 6 sab
  const esFinde = dow === 0 || dow === 6
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
  const diaSemana = dow >= 0 ? dias[dow] : ''

  const minEntrada = horaToMinutos(horaEntrada)
  const minSalida = horaToMinutos(horaSalida)
  if (minEntrada === null || minSalida === null || minSalida <= minEntrada) {
    return { trabajados: 0, normales: 0, extra: 0, esFindesemana: esFinde, diaSemana }
  }
  const trabajados = minSalida - minEntrada

  if (esFinde) {
    return { trabajados, normales: 0, extra: trabajados, esFindesemana: true, diaSemana }
  }

  const minBaseEntrada = horaToMinutos(config.hora_entrada) ?? 540  // 9:00 default
  const minBaseSalida = horaToMinutos(config.hora_salida) ?? 1080   // 18:00 default

  const overlapInicio = Math.max(minEntrada, minBaseEntrada)
  const overlapFin = Math.min(minSalida, minBaseSalida)
  const normales = Math.max(0, overlapFin - overlapInicio)
  const extra = trabajados - normales

  return { trabajados, normales, extra, esFindesemana: false, diaSemana }
}

/** Convierte minutos a horas con decimal (ej. 90 → 1.5) */
export function minutosAHoras(minutos: number): number {
  return minutos / 60
}
