/**
 * Remuneraciones → Estado de Resultados.
 *
 * El costo de las liquidaciones PAGADAS se contabiliza AUTOMÁTICAMENTE, partido
 * en las DOS partidas que el dueño usa (ambas en el subgrupo «Personal»):
 *
 *   · «Personal»      (clave `remuneraciones`) → lo que se le TRANSFIERE al
 *                       trabajador: el líquido a pagar, más el reembolso de
 *                       salud de quien no tiene previsión.
 *   · «Imposiciones»  (clave `imposiciones`)   → todo lo demás: las cotizaciones
 *                       que se le retienen y se remesan (AFP, salud, cesantía) y
 *                       los aportes de cargo del empleador.
 *
 * Imposiciones se calcula por diferencia (costo empresa − transferido), no
 * sumando líneas: así el caso de quien no tiene previsión sale solo. A Juan se le
 * retiene el 7% y se le devuelve en mano, de modo que ese monto es transferencia
 * y NO imposición — restar lo transferido lo deja del lado correcto sin ninguna
 * regla especial.
 *
 * Todo se imputa al mes DEVENGADO (el período de la liquidación), no al día en
 * que se hizo la transferencia: el sueldo de julio es costo de julio aunque se
 * pague el 5 de agosto.
 *
 * Es una fuente automática, igual que los pagos de retiros adicionales
 * (lib/eerr-retiros.ts): NO hay que cargar los sueldos a mano en Compras ni en
 * Gastos manuales — si además se cargan a mano quedan contados dos veces.
 */
import { getSheetData } from '@/lib/datastore'
import { parseDecimalOr0 } from '@/lib/numbers'
import { ultimoDiaDelPeriodo } from './periodo'

/** Partida que recibe lo transferido al trabajador. */
export const CLAVE_REMUNERACIONES = 'remuneraciones'
/** Partida que recibe las cotizaciones y los aportes patronales. */
export const CLAVE_IMPOSICIONES = 'imposiciones'

export interface CostoRemuneracionEerr {
  id: string
  /** ISO YYYY-MM-DD — último día del período devengado (define el mes contable). */
  fecha: string
  periodo: string
  empleado: string
  /** Líquido + reembolso de salud: lo que se le deposita. */
  transferido: number
  /** Cotizaciones retenidas que se remesan + aportes del empleador. */
  imposiciones: number
  /** transferido + imposiciones. */
  costo_empresa: number
}

function partidaConClave<T extends { tipo?: string; clave?: string }>(partidas: T[], clave: string): T | undefined {
  return partidas.find(p => (p.clave || '') === clave && p.tipo !== 'ingreso')
}

/** La partida que recibe lo transferido al trabajador, si existe. */
export function partidaRemuneraciones<T extends { tipo?: string; clave?: string }>(partidas: T[]): T | undefined {
  return partidaConClave(partidas, CLAVE_REMUNERACIONES)
}

/** La partida que recibe las cotizaciones y aportes, si existe. */
export function partidaImposiciones<T extends { tipo?: string; clave?: string }>(partidas: T[]): T | undefined {
  return partidaConClave(partidas, CLAVE_IMPOSICIONES)
}

/** Liquidaciones pagadas listas para imputar al EERR. */
export async function getCostoRemuneracionesEerr(): Promise<CostoRemuneracionEerr[]> {
  const rows = await getSheetData('rrhh_liquidaciones').catch(() => [] as Record<string, string>[])
  return rows
    .filter(r => String(r.estado) === 'pagada')
    .map(r => {
      const costo = Math.round(parseDecimalOr0(r.costo_empresa))
      const transferido = Math.round(parseDecimalOr0(r.total_a_transferir))
      return {
        id: String(r.id || ''),
        periodo: String(r.periodo || ''),
        fecha: ultimoDiaDelPeriodo(String(r.periodo || '')),
        empleado: String(r.empleado_nombre || ''),
        transferido,
        imposiciones: Math.max(0, costo - transferido),
        costo_empresa: costo,
      }
    })
    .filter(c => /^\d{4}-\d{2}-\d{2}$/.test(c.fecha) && c.costo_empresa > 0)
}
