// Ánforas premium incluidas en el servicio Cremación Premium (CP).
//
// Decisión de negocio: cuando el servicio es Cremación Premium, el tutor recibe
// UNA (1) ánfora de la categoría "Ánforas Premium" SIN costo (viene incluida en
// el servicio). Si el tutor pide MÁS de una ánfora premium, la primera va incluida
// y las SIGUIENTES se cobran a su precio de catálogo. Igual se descuenta stock por
// cada unidad elegida (eso lo maneja el ajuste de stock en /api/clientes/[id], que
// usa la cantidad y no el precio). Las ánforas básicas ("Ánforas Greda") ya son $0.
//
// Este módulo es PURO (sin imports de servidor) para poder usarse tanto en los
// componentes cliente (ficha de cliente) como en el cálculo de snapshot del
// servidor (lib/price-calculator).

/** El servicio que incluye un ánfora premium sin costo (Cremación Premium, CP). */
export function servicioIncluyeAnforaPremium(codigoServicio?: string | null): boolean {
  return (codigoServicio || '').trim().toUpperCase() === 'CP'
}

/**
 * ¿La categoría del producto corresponde a "ánforas premium"?
 * Hoy la categoría se llama "Ánforas Premium". Se exige "ánfora"/"anfora" +
 * "premium" (tolerando tilde y mayúsculas) para no incluir por error otras
 * categorías (p. ej. un futuro "Relicarios Premium").
 */
export function esCategoriaAnforaPremium(categoria?: string | null): boolean {
  const c = (categoria || '').toLowerCase()
  return c.includes('premium') && (c.includes('anfora') || c.includes('ánfora'))
}

/**
 * ¿Este producto adicional va INCLUIDO (costo 0) por ser un ánfora premium
 * dentro de un servicio Cremación Premium? El stock se descuenta igual.
 */
export function anforaPremiumIncluida(
  codigoServicio: string | null | undefined,
  categoria: string | null | undefined
): boolean {
  return servicioIncluyeAnforaPremium(codigoServicio) && esCategoriaAnforaPremium(categoria)
}

export interface ItemAdicional {
  tipo?: string
  id?: string
  nombre?: string
  precio?: number
  qty?: number
}
/** @deprecated usa ItemAdicional. */
export type ItemParaCobro = ItemAdicional

/** Unidades de ánfora premium que van INCLUIDAS gratis en un servicio CP (una). */
export const ANFORAS_PREMIUM_INCLUIDAS_CP = 1

export interface RepartoAnfora<T> {
  item: T
  /** Unidades a COBRAR de este ítem (a su precio de catálogo). */
  qtyCobrable: number
  /** Unidades que van incluidas gratis (0 salvo el ánfora premium del CP). */
  qtyIncluida: number
  esPremium: boolean
}

/**
 * Reparte los adicionales aplicando la regla de negocio: en Cremación Premium (CP)
 * va incluida UNA unidad de ánfora premium; las unidades premium ADICIONALES se
 * cobran. Devuelve, por ítem, cuántas unidades se cobran y cuántas van incluidas.
 * Los ítems no-premium se cobran íntegros.
 *
 * La unidad incluida se descuenta de la PRIMERA ánfora premium encontrada (todas
 * valen lo mismo hoy, así que el orden no cambia el monto). Fuente ÚNICA de la
 * regla — la usan el snapshot de precio, el disparo de cobro (ficha + bot), el
 * resumen del correo y el preview del editor, para que todos calcen 1:1.
 *
 * `categoriaPorProductoId` = Map<id, categoria> de la tabla `productos`.
 */
export function repartirAnforasPremium<T extends ItemAdicional>(
  codigoServicio: string | null | undefined,
  items: T[],
  categoriaPorProductoId: Map<string, string>,
): RepartoAnfora<T>[] {
  let disponibles = servicioIncluyeAnforaPremium(codigoServicio) ? ANFORAS_PREMIUM_INCLUIDAS_CP : 0
  return items.map(item => {
    const qty = Math.max(0, Math.trunc(item.qty ?? 1))
    const esPremium = item.tipo === 'producto' && !!item.id &&
      esCategoriaAnforaPremium(categoriaPorProductoId.get(String(item.id)))
    let qtyIncluida = 0
    if (esPremium && disponibles > 0) {
      qtyIncluida = Math.min(disponibles, qty)
      disponibles -= qtyIncluida
    }
    return { item, qtyCobrable: qty - qtyIncluida, qtyIncluida, esPremium }
  })
}

/**
 * Ítems que van a COBRARSE por adicional, con la ánfora premium incluida ya
 * descontada: un ítem premium con qty 2 en un CP vuelve con qty 1 (se cobra 1, la
 * otra va incluida); un ítem premium con qty 1 se omite. El resto pasa intacto.
 *
 * Bug histórico (2026-07): antes se filtraba TODA ánfora premium (costo de
 * catálogo directo), así que 2 ánforas en un CP no cobraban ninguna. Ahora se
 * cobra a partir de la segunda.
 */
export function excluirIncluidos<T extends ItemAdicional>(
  codigoServicio: string | null | undefined,
  items: T[],
  categoriaPorProductoId: Map<string, string>,
): T[] {
  return repartirAnforasPremium(codigoServicio, items, categoriaPorProductoId)
    .filter(r => r.qtyCobrable > 0)
    .map(r => (r.qtyIncluida > 0 ? { ...r.item, qty: r.qtyCobrable } : r.item))
}
