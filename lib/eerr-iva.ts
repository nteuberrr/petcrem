import { getSheetData } from './datastore'
import { ivaDeCompra, periodoSiiDe } from './eerr-compras-ingesta'
import type { DocVentaSii } from './sii-ventas'

/**
 * POSICIÓN DE IVA mes a mes — cuánto habría que declarar en el F29.
 *
 * Fuente ÚNICA: la comparten el Balance (que además arrastra el remanente) y la
 * línea del EERR. No duplicar el cálculo en ninguno de los dos.
 *
 *  - **DÉBITO** — el IVA de lo que efectivamente se **boleteó o facturó**, salido
 *    de los documentos que el SII registra (`conciliacion_sii.docs_json`, que se
 *    llena al sincronizar o al cargar el archivo del RCV). Las notas de crédito
 *    restan. Decisión del dueño: solo lo documentado suma. **No se estima desde
 *    las fichas** — se probó y no sirve: las fichas anteriores a junio-2026 no
 *    tienen `precio_total` guardado, así que el débito salía casi en cero
 *    mientras el crédito estaba completo, y la resta daba negativos gigantes por
 *    un lado que faltaba.
 *  - **CRÉDITO** — el IVA de las FACTURAS de compra (`eerr_gastos_sii`, que son
 *    todas facturas). Las boletas no dan crédito y por eso las rendiciones no
 *    entran. Las notas de crédito restan (`ivaDeCompra`) y las exentas aportan
 *    cero solas. Se imputa al **período tributario del SII** (`periodoSiiDe`), no
 *    al mes de emisión.
 *
 * ⚠️ Solo se informan los períodos donde el débito se CONOCE, que son dos casos:
 * los que tienen el registro de ventas del SII cargado, y los anteriores a la
 * primera venta, donde el débito es cero por definición. Un mes posterior sin
 * cargar no vale cero: vale «no sabemos», y mostrarlo como cero daría un
 * remanente a favor inventado del tamaño de todo el crédito del mes. Para que
 * aparezca un mes nuevo hay que sincronizarlo en Facturación → Conciliación.
 */

/**
 * Mes de la primera venta de la empresa. Antes de esto hubo compras (montaje del
 * crematorio) pero ningún ingreso, así que el débito de esos meses es CERO —dato,
 * no laguna— y su crédito es remanente legítimo que se arrastra hacia adelante.
 */
export const VENTAS_DESDE = '2025-12'

export interface IvaMes {
  /** IVA de las ventas documentadas del período (notas de crédito restadas). */
  debito: number
  /** IVA de las facturas de compra del período. */
  credito: number
}

/** Débito de un período: IVA de boletas y facturas, menos el de las notas de crédito. */
function debitoDeDocumentos(docsJson: string): number {
  let total = 0
  try {
    for (const d of JSON.parse(docsJson || '[]') as DocVentaSii[]) {
      total += (d.grupo === 'notas_credito' ? -1 : 1) * (Number(d.iva) || 0)
    }
  } catch { /* período sin documentos guardados */ }
  return Math.round(total)
}

const esPeriodo = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s)

/**
 * Débito y crédito de cada período con registro de ventas cargado, del más
 * antiguo al más nuevo.
 */
export async function ivaPorMes(): Promise<Map<string, IvaMes>> {
  const [conciliaciones, gastosSii] = await Promise.all([
    getSheetData('conciliacion_sii'),
    getSheetData('eerr_gastos_sii'),
  ])

  const out = new Map<string, IvaMes>()
  for (const c of conciliaciones) {
    const periodo = String(c.periodo || '').trim()
    if (!esPeriodo(periodo)) continue
    out.set(periodo, { debito: debitoDeDocumentos(c.docs_json), credito: 0 })
  }

  for (const f of gastosSii) {
    const periodo = periodoSiiDe(f)
    if (!esPeriodo(periodo)) continue
    // Antes de la primera venta no hay registro que cargar y tampoco hace falta:
    // el débito es cero y el crédito de esas compras es remanente que se arrastra.
    if (!out.has(periodo) && periodo < VENTAS_DESDE) out.set(periodo, { debito: 0, credito: 0 })
    const m = out.get(periodo)
    if (m) m.credito += ivaDeCompra(f)
  }
  for (const v of out.values()) v.credito = Math.round(v.credito)

  return new Map([...out.entries()].sort(([a], [b]) => a.localeCompare(b)))
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
  const debito = new Array<number>(n).fill(0)
  const credito = new Array<number>(n).fill(0)

  for (const [mes, v] of porMes) {
    const i = periodIdx(`${mes}-01`)
    if (i === undefined) continue
    debito[i] += v.debito
    credito[i] += v.credito
  }
  // Neto = lo que habría que pagar. Negativo es remanente a favor.
  return { debito, credito, neto: debito.map((d, i) => d - credito[i]) }
}
