/**
 * Remuneraciones → Estado de Resultados.
 *
 * El costo de las liquidaciones PAGADAS se contabiliza AUTOMÁTICAMENTE en la
 * partida del EERR marcada con la clave `remuneraciones` (hoy «Personal»),
 * imputado al mes DEVENGADO (el período de la liquidación), no al día en que se
 * hizo la transferencia: el sueldo de julio es costo de julio aunque se pague el
 * 5 de agosto.
 *
 * Es una fuente automática, igual que los pagos de retiros adicionales
 * (lib/eerr-retiros.ts): NO hay que cargar los sueldos a mano en Compras ni en
 * Gastos manuales — si además se cargan a mano quedan contados dos veces.
 *
 * El monto es el COSTO EMPRESA: haberes brutos + aportes de cargo del empleador
 * (+ el reembolso de salud de quien no tiene previsión). Las cotizaciones del
 * trabajador ya están dentro de los haberes brutos; sumarlas aparte sería doble
 * conteo.
 */
import { getSheetData } from '@/lib/datastore'
import { parseDecimalOr0 } from '@/lib/numbers'
import { ultimoDiaDelPeriodo } from './periodo'

/** Clave que marca la partida del EERR alimentada por las remuneraciones. */
export const CLAVE_REMUNERACIONES = 'remuneraciones'

export interface CostoRemuneracionEerr {
  id: string
  /** ISO YYYY-MM-DD — último día del período devengado (define el mes contable). */
  fecha: string
  periodo: string
  empleado: string
  monto: number
}

/** La partida (costo/gasto) que recibe el costo de remuneraciones, si existe. */
export function partidaRemuneraciones<T extends { tipo?: string; clave?: string }>(partidas: T[]): T | undefined {
  return partidas.find(p => (p.clave || '') === CLAVE_REMUNERACIONES && p.tipo !== 'ingreso')
}

/** Liquidaciones pagadas listas para imputar al EERR. */
export async function getCostoRemuneracionesEerr(): Promise<CostoRemuneracionEerr[]> {
  const rows = await getSheetData('rrhh_liquidaciones').catch(() => [] as Record<string, string>[])
  return rows
    .filter(r => String(r.estado) === 'pagada')
    .map(r => ({
      id: String(r.id || ''),
      periodo: String(r.periodo || ''),
      fecha: ultimoDiaDelPeriodo(String(r.periodo || '')),
      empleado: String(r.empleado_nombre || ''),
      monto: Math.round(parseDecimalOr0(r.costo_empresa)),
    }))
    .filter(c => /^\d{4}-\d{2}-\d{2}$/.test(c.fecha) && c.monto > 0)
}
