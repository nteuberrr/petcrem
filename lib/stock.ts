import { getSheetData, updateByIdIf } from './datastore'

const MAX_INTENTOS = 6

/**
 * Ajusta el stock de un producto de forma ATÓMICA mediante compare-and-set sobre
 * el valor actual de `stock` (optimistic locking con reintento).
 *
 * `delta > 0` suma unidades, `delta < 0` resta; nunca baja de 0. Cada intento
 * relee el stock y solo escribe si NADIE lo cambió entremedio (la condición
 * `expected.stock` del updateByIdIf); si perdió la carrera, reintenta con el
 * valor fresco. Esto evita la pérdida de unidades cuando dos ajustes concurrentes
 * (p. ej. dos ventas, o una venta + una edición) leen el mismo stock y uno pisa
 * al otro.
 *
 * Devuelve el nuevo stock, o `null` si el producto no existe o no se pudo
 * actualizar tras varios reintentos.
 */
export async function ajustarStock(productoId: string, delta: number): Promise<number | null> {
  for (let intento = 0; intento < MAX_INTENTOS; intento++) {
    const rows = await getSheetData('productos')
    const p = rows.find(r => String(r.id) === String(productoId))
    if (!p) return null

    const actual = parseInt(p.stock || '0', 10) || 0
    if (delta === 0) return actual

    const nuevo = Math.max(0, actual + delta)
    // CAS: escribe solo si el stock sigue siendo el que leímos.
    const ok = await updateByIdIf('productos', productoId, { stock: p.stock ?? '' }, { stock: String(nuevo) })
    if (ok) return nuevo
    // Otro proceso cambió el stock entre la lectura y la escritura → reintentar.
  }
  return null
}

export type ItemStock = { tipo?: string; id?: string; qty?: number }

/**
 * Ajusta el stock de productos según el DIFF entre dos listas de adicionales de
 * una ficha (solo ítems tipo 'producto'; los 'servicio' no llevan stock).
 * Casos: crear ficha → ajustarStockAdicionales([], nuevos) · editar → (viejos,
 * nuevos) · eliminar ficha → (viejos, []). Secuencial (no Promise.all): cada
 * ajuste es un compare-and-set que relee el stock.
 */
export async function ajustarStockAdicionales(oldItems: ItemStock[], newItems: ItemStock[]): Promise<void> {
  const oldQty: Record<string, number> = {}
  const newQty: Record<string, number> = {}
  for (const a of oldItems) if (a.tipo === 'producto' && a.id) oldQty[a.id] = (oldQty[a.id] || 0) + (a.qty ?? 1)
  for (const a of newItems) if (a.tipo === 'producto' && a.id) newQty[a.id] = (newQty[a.id] || 0) + (a.qty ?? 1)
  const allIds = new Set([...Object.keys(oldQty), ...Object.keys(newQty)])
  for (const pid of allIds) {
    const delta = (oldQty[pid] || 0) - (newQty[pid] || 0) // positivo = devuelve, negativo = consume
    if (delta === 0) continue
    await ajustarStock(pid, delta)
  }
}
