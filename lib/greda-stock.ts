import { getSheetData } from './datastore'
import { ajustarStock } from './stock'
import { parseDecimal } from './numbers'

/**
 * Descuento automático de stock de las ánforas de GREDA (las incluidas en la
 * Cremación Individual). A diferencia de las premium/relicarios —que se
 * descuentan al elegirse como adicional— la greda no se elige: se usa la que
 * corresponda al trasvasijar. Regla de negocio (2026-07-14): se descuenta por
 * TRAMO DE PESO al registrar la ficha:
 *
 *    0–10 kg → Marmoleada S · 10–30 kg → Marmoleada M · 30+ kg → Marmoleada L
 *
 * En el límite exacto (10 ó 30 kg justos) aplica el tramo MENOR, igual que la
 * regla de precios del sistema (findTramo, lib/tramos.ts).
 *
 * El producto descontado se persiste en `clientes.greda_descontada`:
 *   ''    → ficha LEGADA (anterior a esta funcionalidad): no se toca nunca,
 *           para no descontar retroactivamente inventario ya contado.
 *   '-'   → ficha tracked pero sin greda (otro servicio, sin peso, o no se
 *           encontró el producto en Bodega).
 *   '<id>'→ id del producto de Bodega descontado (permite devolver/re-tramar).
 */

export type TallaGreda = 'S' | 'M' | 'L'

/** Talla de greda por peso. Límite exacto → tramo menor (10 kg → S, 30 kg → M). */
export function tallaGredaParaPeso(peso: number): TallaGreda | null {
  if (!Number.isFinite(peso) || peso <= 0) return null
  if (peso <= 10) return 'S'
  if (peso <= 30) return 'M'
  return 'L'
}

/** Sin greda que descontar (tracked, pero ninguna unidad consumida). */
export const SIN_GREDA = '-'

type FichaLike = Record<string, unknown>

function pesoDeFicha(ficha: FichaLike): number {
  // peso_ingreso (real) manda sobre peso_declarado; '' no pisa (|| semántica).
  return parseDecimal(String(ficha.peso_ingreso ?? '')) || parseDecimal(String(ficha.peso_declarado ?? '')) || 0
}

/**
 * id del producto de Bodega para una talla: categoría con "greda" + nombre
 * terminado en la talla (" S" / " M" / " L", ej. "Marmoleada M"), activo.
 */
export async function productoGredaId(talla: TallaGreda): Promise<string | null> {
  const productos = await getSheetData('productos')
  const sufijo = new RegExp(`\\s${talla}$`, 'i')
  const p = productos.find(r =>
    (r.categoria || '').toLowerCase().includes('greda') &&
    r.activo !== 'FALSE' &&
    sufijo.test((r.nombre || '').trim())
  )
  return p ? String(p.id) : null
}

/**
 * Greda que ESTA ficha debería tener descontada según sus datos actuales.
 * Solo fichas REGISTRADAS (con código, no borrador) de Cremación Individual.
 * Devuelve el id del producto, o SIN_GREDA si no corresponde descuento.
 */
export async function gredaEsperada(ficha: FichaLike): Promise<string> {
  const registrada = String(ficha.codigo || '').trim() !== '' && ficha.estado !== 'borrador'
  if (!registrada) return SIN_GREDA
  if (String(ficha.codigo_servicio || '').trim().toUpperCase() !== 'CI') return SIN_GREDA
  const talla = tallaGredaParaPeso(pesoDeFicha(ficha))
  if (!talla) return SIN_GREDA
  const id = await productoGredaId(talla)
  if (!id) {
    console.error(`[greda-stock] no se encontró en Bodega un ánfora de greda talla ${talla} (categoría "greda", nombre terminado en " ${talla}") — no se descuenta stock`)
    return SIN_GREDA
  }
  return id
}

/**
 * Aplica en Bodega el cambio de greda de una ficha: devuelve la anterior y
 * descuenta la nueva (si cambió). `previa`/`nueva` son valores del formato de
 * `greda_descontada` ('' | '-' | '<id>'). Best-effort: cada ajuste es un
 * compare-and-set con reintentos (lib/stock.ts) y nunca baja el stock de 0.
 */
export async function aplicarCambioGreda(previa: string, nueva: string): Promise<void> {
  const prevId = previa && previa !== SIN_GREDA ? previa : null
  const nextId = nueva && nueva !== SIN_GREDA ? nueva : null
  if (prevId === nextId) return
  if (prevId) await ajustarStock(prevId, +1)
  if (nextId) await ajustarStock(nextId, -1)
}
