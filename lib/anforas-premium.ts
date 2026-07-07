// Ánforas premium incluidas en el servicio Cremación Premium (CP).
//
// Decisión de negocio: cuando el servicio es Cremación Premium, el tutor puede
// elegir CUALQUIER ánfora de la categoría "Ánforas Premium" SIN costo (viene
// incluida en el servicio). Igual se descuenta una unidad de stock al elegirla
// (eso lo maneja el ajuste de stock en /api/clientes/[id], que usa la cantidad
// y no el precio). Las ánforas básicas ("Ánforas Greda") ya son $0 y no se ven
// afectadas.
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

export interface ItemParaCobro {
  tipo?: string
  id?: string
  precio?: number
}

/**
 * Filtra de una lista de ítems (los que van a COBRARSE por adicional) los que
 * en realidad vienen INCLUIDOS gratis por ser ánfora premium de un servicio CP.
 *
 * Bug real (2026-07): el disparador de cobro tomaba el precio de catálogo del
 * ítem tal cual, sin chequear `anforaPremiumIncluida` — se envió un correo
 * cobrando $25.000 por un ánfora que venía incluida en la Cremación Premium.
 * El total/snapshot de la ficha SIEMPRE la excluyó bien (calcularSnapshotFicha);
 * el bug estaba solo en el camino de cobro (route de clientes + bot), que lee
 * el precio de catálogo directo del ítem sin pasar por esa lógica.
 *
 * `categoriaPorProductoId` = Map<id, categoria> de la tabla `productos`.
 */
export function excluirIncluidos<T extends ItemParaCobro>(
  codigoServicio: string | null | undefined,
  items: T[],
  categoriaPorProductoId: Map<string, string>,
): T[] {
  return items.filter(it => {
    if (it.tipo !== 'producto' || !it.id) return true
    return !anforaPremiumIncluida(codigoServicio, categoriaPorProductoId.get(String(it.id)))
  })
}
