import { normalizar } from './comunas'
import { esFeriado } from './feriados'

/**
 * Reglas de CARGO AUTOMÁTICO de "otros servicios" en la ficha de cremación.
 * Un servicio de `otros_servicios` con `auto_regla` se PRE-CARGA solo en los
 * adicionales al crear/registrar una ficha (siempre deseleccionable a mano):
 *
 *  - 'fuera_horario': retiros desde las 18:00 de lunes a viernes, y a
 *    CUALQUIER hora los sábados y domingos (regla del dueño, 2026-07-13;
 *    corte movido de 19:00 → 18:00 el 2026-07-20).
 *  - 'distancia': la comuna de retiro está en la lista `comunas` del servicio
 *    (JSON array de nombres; match sin tildes/mayúsculas vía lib/comunas).
 *
 * La usan el formulario de alta (/clientes), la ficha ([id], al registrar un
 * borrador) y el prompt del agente de WhatsApp (para avisar el recargo al
 * cotizar). Client-safe: sin imports de servidor.
 */

export type ReglaAuto = '' | 'fuera_horario' | 'distancia'

/** Hora (inclusive) desde la que un retiro de día de semana es "fuera de horario". */
export const HORA_FUERA_HORARIO = '18:00'

export interface ServicioAuto {
  auto_regla?: string
  comunas?: string
}

/** Comunas configuradas en un servicio 'distancia' (columna JSON). */
export function comunasDeServicio(comunasJson: string | undefined): string[] {
  if (!comunasJson) return []
  try {
    const arr = JSON.parse(comunasJson)
    return Array.isArray(arr) ? arr.map(c => String(c).trim()).filter(Boolean) : []
  } catch {
    // Tolerar una lista separada por comas escrita a mano.
    return String(comunasJson).split(',').map(c => c.trim()).filter(Boolean)
  }
}

/**
 * ¿El retiro es fuera de horario? Sábado/domingo y FERIADOS siempre (todo el
 * día); L-V hábil desde las 18:00 (inclusive). Sin fecha no se puede saber →
 * false. Sin hora en día de semana hábil → false (se asume dentro de horario
 * hasta que se coordine la hora).
 */
export function esFueraDeHorario(fechaISO: string | undefined, horaHHMM: string | undefined): boolean {
  const fecha = (fechaISO || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false
  const d = new Date(`${fecha}T12:00:00`) // mediodía: inmune a corrimientos de TZ
  if (isNaN(d.getTime())) return false
  const dia = d.getDay() // 0=domingo, 6=sábado
  // Fin de semana o feriado (aunque sea día de semana) → recargo TODO el día.
  if (dia === 0 || dia === 6 || esFeriado(fecha)) return true
  const hora = (horaHHMM || '').trim()
  if (!/^\d{1,2}:\d{2}/.test(hora)) return false
  return hora.padStart(5, '0') >= HORA_FUERA_HORARIO
}

/** ¿La comuna del retiro tiene recargo por distancia según la lista del servicio? */
export function esComunaConRecargo(comuna: string | undefined, comunasJson: string | undefined): boolean {
  const c = normalizar(comuna || '')
  if (!c) return false
  return comunasDeServicio(comunasJson).some(x => normalizar(x) === c)
}

/** ¿Aplica la regla automática de este servicio para los datos de retiro dados? */
export function aplicaReglaAuto(
  s: ServicioAuto,
  ctx: { fecha?: string; hora?: string; comuna?: string },
): boolean {
  const regla = (s.auto_regla || '').trim()
  if (regla === 'fuera_horario') return esFueraDeHorario(ctx.fecha, ctx.hora)
  if (regla === 'distancia') return esComunaConRecargo(ctx.comuna, s.comunas)
  return false
}

/**
 * REGLA ÚNICA DEL RECARGO FUERA DE HORARIO (dueño 2026-07-28).
 *
 * El recargo aplica SOLO cuando el servicio cae después de las 18:00 (o en fin de
 * semana/feriado), y se cobra UNA SOLA VEZ por atención aunque caigan fuera las
 * DOS partes (la eutanasia a domicilio y el retiro para la cremación):
 *   - solo la eutanasia fuera de horario  → $10.000, va con la EUTANASIA
 *   - solo el retiro fuera de horario     → $10.000, va en la CREMACIÓN
 *   - las dos fuera de horario            → $10.000 (NO $20.000), y lo lleva la
 *                                           EUTANASIA
 *
 * Por qué la eutanasia tiene prioridad cuando las dos caen fuera: su cobro va
 * FUERA DE LA BOLETA (la boleta cubre solo la cremación) y se cobra igual cuando
 * el cliente pide eutanasia sin cremación. Ponerlo en la cremación lo metería
 * adentro de la boleta, donde no corresponde.
 *
 * Ojo con el caso que esto NO es: una eutanasia a las 15:45 con retiro a las
 * 19:00 SÍ paga recargo, y lo lleva la CREMACIÓN — la eutanasia quedó dentro de
 * horario y no le corresponde nada. La regla es la hora de cada parte, no la
 * existencia de la eutanasia.
 */
export function cremacionLlevaRecargoFueraHorario(ctx: {
  /** El retiro para la cremación cae fuera de horario. */
  retiroFueraHorario: boolean
  /** La eutanasia asociada ya está cobrando su propio recargo fuera de horario. */
  eutanasiaYaCobraRecargo: boolean
}): boolean {
  return ctx.retiroFueraHorario && !ctx.eutanasiaYaCobraRecargo
}

/** Etiqueta corta de la regla (UI de Configuración y hints de la ficha). */
export function etiquetaRegla(regla: string | undefined): string {
  if (regla === 'fuera_horario') return 'Auto: fuera de horario (18:00+, fin de semana y feriados)'
  if (regla === 'distancia') return 'Auto: por comuna (distancia)'
  return ''
}
