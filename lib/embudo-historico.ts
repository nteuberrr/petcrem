/**
 * REGISTRO HISTÓRICO MANUAL del embudo — lo que el dueño llevaba a mano ANTES de
 * conectar las APIs (inbox de WhatsApp + sistema de fichas). El sistema no tiene
 * esos datos de forma fechada:
 *   - Leads: el inbox recién captura desde jun-2026 (ver LEADS_CONFIABLES_DESDE).
 *   - Ventas: la tabla `clientes` no tiene fichas antes del 20-abr-2026; ese día
 *     se cargó todo el histórico al sistema con una sola fecha_creacion → la
 *     semana S17/26 aparece con un pico irreal (~139). Por eso esa semana se
 *     marca como "carga inicial" y su venta NO se cuenta (queda "—").
 *
 * Estos números salen de la planilla de seguimiento del dueño. `calcularEmbudoSemanal`
 * los usa para las semanas que cubren; de ahí en adelante manda el dato en vivo.
 * Las impresiones/clics NO se cargan acá: Google Ads tiene la historia completa.
 *
 * Clave = lunes ISO de la semana (YYYY-MM-DD).
 */

export interface HistoricoSemana {
  leads?: number
  ventas?: number
  nota?: string
}

export const EMBUDO_HISTORICO: Record<string, HistoricoSemana> = {
  '2025-12-15': { leads: 23, ventas: 5 },   // S51/25
  '2025-12-22': { leads: 26, ventas: 5 },   // S52/25
  '2025-12-29': { leads: 20, ventas: 2 },   // S01/26
  '2026-01-05': { leads: 7, ventas: 11 },   // S02/26
  '2026-01-12': { leads: 0, ventas: 1, nota: 'Wave nos desactiva la cuenta' }, // S03/26
  '2026-01-19': { leads: 31, ventas: 8 },   // S04/26
  '2026-01-26': { leads: 34, ventas: 8 },   // S05/26
  '2026-02-02': { leads: 56, ventas: 9 },   // S06/26
  '2026-02-09': { leads: 40, ventas: 7 },   // S07/26
  '2026-02-16': { leads: 27, ventas: 3 },   // S08/26
  '2026-02-23': { leads: 42, ventas: 6, nota: 'Se activa campaña Eutanasia' }, // S09/26
  '2026-03-02': { leads: 45, ventas: 10 },  // S10/26
  '2026-03-09': { leads: 41, ventas: 10 },  // S11/26
  '2026-03-16': { leads: 39, ventas: 4 },   // S12/26
  '2026-03-23': { leads: 29, ventas: 7 },   // S13/26
  '2026-03-30': { leads: 45, ventas: 11 },  // S14/26
  '2026-04-06': { leads: 37, ventas: 5, nota: 'Se activa campaña Marca' },     // S15/26
  '2026-04-13': { leads: 49, ventas: 6 },   // S16/26
}

/**
 * Semana (lunes ISO) de la CARGA INICIAL del sistema: el 20-abr-2026 se importaron
 * todas las fichas preexistentes con esa fecha_creacion, inflando la semana con un
 * pico irreal. Su venta se deja en "—" (dato no confiable) hasta que se cargue el
 * valor real desde el registro manual.
 */
export const SEMANA_CARGA_INICIAL = '2026-04-20' // S17/26
