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
 * El recargo se cobra UNA SOLA VEZ por atención, aunque caigan fuera de horario
 * las DOS partes del servicio (la eutanasia a domicilio y el retiro para la
 * cremación).
 *
 * HAY EUTANASIA → EL RECARGO VA CON LA EUTANASIA, SIEMPRE (decisión del dueño
 * 2026-08-17). No importa cuál de las dos partes se pasó de las 18:00: si la
 * atención incluye eutanasia, la cremación NUNCA lo suma. Dos motivos, y los dos
 * son de plata, no de estética:
 *   1. NO SE FACTURA. La boleta cubre la cremación; el recargo se cobra fuera de
 *      ella, igual que el resto del cobro de la eutanasia. Ponerlo en la
 *      cremación lo mete adentro de la boleta, donde no corresponde.
 *   2. SE COBRA IGUAL SIN CREMACIÓN. Una eutanasia sola fuera de horario también
 *      lo paga, así que es un cargo del servicio de eutanasia, no del retiro.
 * Del lado de la eutanasia el recargo se decide mirando su hora Y la del retiro
 * que la sigue (ver `recargoEutanasiaPara` en lib/eutanasia-precios): así el caso
 * real de eutanasia a las 17:45 con retiro a las 18:15 se sigue cobrando — solo
 * que del lado correcto.
 *
 * Sin eutanasia de por medio la regla es la de siempre: lo lleva la cremación si
 * el retiro cae fuera de horario.
 */
export function cremacionLlevaRecargoFueraHorario(ctx: {
  /** El retiro para la cremación cae fuera de horario. */
  retiroFueraHorario: boolean
  /** La atención incluye una eutanasia a domicilio (ella se lleva el recargo). */
  hayEutanasia: boolean
}): boolean {
  return ctx.retiroFueraHorario && !ctx.hayEutanasia
}

/** Etiqueta corta de la regla (UI de Configuración y hints de la ficha). */
export function etiquetaRegla(regla: string | undefined): string {
  if (regla === 'fuera_horario') return 'Auto: fuera de horario (18:00+, fin de semana y feriados)'
  if (regla === 'distancia') return 'Auto: por comuna (distancia)'
  return ''
}
