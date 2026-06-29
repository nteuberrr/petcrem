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
