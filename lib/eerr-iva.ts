import { getSheetData } from './datastore'
import { formatDateForSheet } from './dates'
import { parseDecimalOr0 } from './numbers'
import { ivaDeCompra, periodoSiiDe } from './eerr-compras-ingesta'

/**
 * POSICIÓN DE IVA mes a mes — cuánto habría que declarar en el F29.
 *
 * Fuente ÚNICA: la comparten el Balance (que además arrastra el remanente) y la
 * línea informativa del EERR. No duplicar el cálculo en ninguno de los dos.
 *
 *  - **DÉBITO** — el IVA que cobramos. Toda venta lo genera, se documente con
 *    boleta o con factura. Los precios de las fichas están CON IVA incluido, así
 *    que el débito es `bruto × 19/119`. La eutanasia a domicilio queda fuera: no
 *    vive en `clientes` y no se documenta.
 *  - **CRÉDITO** — el IVA que nos cobraron. Solo las FACTURAS de compra lo dan;
 *    las boletas no, y por eso las rendiciones no entran acá (son boletas). Todo
 *    `eerr_gastos_sii` es factura, así que suma entero. Las notas de crédito
 *    restan (`ivaDeCompra`) y las exentas aportan cero solas.
 *
 * Dos decisiones que importan:
 *
 *  - El crédito se imputa al **período tributario del SII** (`periodoSiiDe`), no
 *    al mes de emisión: una factura del 28-07 sin acuse entra al RCV de agosto y
 *    su crédito se usa en el F29 de agosto.
 *  - El débito se imputa por `fecha_retiro`, la MISMA fecha con la que el EERR
 *    reconoce el ingreso, para que la línea de IVA sea coherente con la de
 *    ingresos que aparece arriba. El F29 real va por la fecha del documento; en
 *    una venta al contado son el mismo día, y en las pocas que no, la diferencia
 *    se corre de mes.
 */

/** Antes de junio 2026 la empresa no pagaba IVA. */
export const IVA_DESDE = '2026-06'
const FACTOR = 19 / 119

export interface IvaMes {
  /** IVA cobrado en las ventas del mes. */
  debito: number
  /** IVA soportado en las facturas de compra del período. */
  credito: number
}

const mesDe = (f: string): string => (formatDateForSheet(f) || '').slice(0, 7)

/** Devuelve el débito y el crédito de cada mes, desde que la empresa paga IVA. */
export async function ivaPorMes(): Promise<Map<string, IvaMes>> {
  const [clientes, gastosSii] = await Promise.all([
    getSheetData('clientes'),
    getSheetData('eerr_gastos_sii'),
  ])

  const out = new Map<string, IvaMes>()
  const acumular = (mes: string, campo: keyof IvaMes, monto: number) => {
    if (!mes || mes < IVA_DESDE || monto === 0) return
    const m = out.get(mes) ?? { debito: 0, credito: 0 }
    m[campo] += monto
    out.set(mes, m)
  }

  for (const c of clientes) {
    if (c.estado === 'borrador') continue
    const bruto = parseDecimalOr0(c.precio_total)
    if (bruto <= 0) continue
    acumular(mesDe(c.fecha_retiro || c.fecha_creacion), 'debito', Math.round(bruto * FACTOR))
  }

  for (const f of gastosSii) acumular(periodoSiiDe(f), 'credito', ivaDeCompra(f))

  return out
}

/**
 * Series de débito, crédito y neto alineadas a los períodos del EERR.
 *
 * `periodIdx` es el mismo mapeador que usa el resto del informe, así que esto
 * funciona igual mostrando meses o un año completo. El mes se ubica por su día
 * 1: sirve tanto si la columna es `YYYY-MM` como si es `YYYY`.
 */
export async function ivaPorPeriodo(
  periodIdx: (iso: string) => number | undefined,
  n: number,
): Promise<{ debito: number[]; credito: number[]; neto: number[] }> {
  const porMes = await ivaPorMes()
  const debito = new Array(n).fill(0)
  const credito = new Array(n).fill(0)

  for (const [mes, v] of porMes) {
    const i = periodIdx(`${mes}-01`)
    if (i === undefined) continue
    debito[i] += v.debito
    credito[i] += v.credito
  }
  // Neto = lo que habría que pagar. Negativo significa remanente a favor, y se
  // muestra como tal en vez de fingir un pago negativo.
  return { debito, credito, neto: debito.map((d, i) => d - credito[i]) }
}
