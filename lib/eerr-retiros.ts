/**
 * Pagos de retiros adicionales (Asistencia → Adicionales) → Estado de Resultados.
 *
 * Cada pago que se registra en `pagos_retiros` (un chofer, N retiros fuera de
 * jornada, un monto) se contabiliza AUTOMÁTICAMENTE como gasto en la partida del
 * EERR marcada con la clave `retiros_adicionales` (hoy «Rendiciones fuera
 * horario»), imputado al mes de `fecha_pago` — la fecha en que se rindió el pago.
 *
 * Es una fuente automática, igual que los ingresos calculados desde las fichas:
 * NO hay que cargar estos pagos a mano en Compras ni en Rendiciones (si además se
 * cargan a mano quedan contados dos veces).
 */
import { getSheetData } from './datastore'
import { formatDateForSheet } from './dates'

/** Clave que marca la partida del EERR alimentada por los pagos de retiros. */
export const CLAVE_RETIROS = 'retiros_adicionales'

export interface PagoRetiroEerr {
  id: string
  /** ISO YYYY-MM-DD — fecha del pago (define el mes en que se contabiliza). */
  fecha: string
  usuario: string
  cantidad: number
  monto: number
}

/** La partida (costo/gasto) que recibe los pagos de retiros, si existe. */
export function partidaRetiros<T extends { tipo?: string; clave?: string }>(partidas: T[]): T | undefined {
  return partidas.find(p => (p.clave || '') === CLAVE_RETIROS && p.tipo !== 'ingreso')
}

/** Pagos de retiros adicionales listos para imputar al EERR. */
export async function getPagosRetirosEerr(): Promise<PagoRetiroEerr[]> {
  const rows = await getSheetData('pagos_retiros')
  return rows
    .map(r => ({
      id: String(r.id || ''),
      fecha: formatDateForSheet(r.fecha_pago) || String(r.fecha_pago || ''),
      usuario: String(r.usuario_nombre || ''),
      cantidad: parseInt(r.cantidad || '0', 10) || 0,
      monto: Math.round(parseFloat(r.monto_total) || 0),
    }))
    .filter(p => p.fecha && p.monto > 0)
}
