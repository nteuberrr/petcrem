import { parseDecimalOr0, parsePeso, parseMonto } from './numbers'
import { findTramo, precioDelTramo } from './tramos'

/**
 * Cálculo de precio de una ficha — snapshot si existe, fallback en vivo si no
 * (fichas legacy). Extraído de lib/informe-veterinaria.ts para que el informe
 * de veterinaria y la propuesta de "Facturar Veterinarios" (lib/facturacion-vets.ts)
 * usen EXACTAMENTE el mismo cálculo: lo que el vet ve en su informe es lo que se
 * le factura, sin margen de divergencia.
 */

export type Tramo = {
  id?: string
  peso_min: string
  peso_max: string
  precio_ci: string
  precio_cp: string
  precio_sd: string
  veterinaria_id?: string
}
export type AdicionalItem = { tipo: string; id: string; nombre?: string; precio?: number; qty?: number }

export interface PrecioFichaCalculado {
  servicio: number
  adicionales: number
  descuento: number
  total: number
  adicionalesLabel: string
}

export interface TablasPrecios {
  generales: Tramo[]
  convenio: Tramo[]
  /** Tramos especiales YA filtrados para la veterinaria de esta ficha. */
  especialesDeVet: Tramo[]
}

/** Calcula el precio de una ficha de cliente. `vetTipoPrecios` = veterinarios.tipo_precios del vet asociado (si tiene). */
export function calcularPrecioFicha(
  c: Record<string, string>,
  vetTipoPrecios: string | undefined,
  tablas: TablasPrecios,
): PrecioFichaCalculado {
  const snapTotal = parseDecimalOr0(c.precio_total)
  const snapServ = parseDecimalOr0(c.precio_servicio)
  const snapAdi = parseDecimalOr0(c.precio_adicionales)
  const snapDesc = parseDecimalOr0(c.descuento_monto)
  let items: AdicionalItem[] = []
  try { items = JSON.parse(c.adicionales || '[]') } catch { items = [] }
  const adicionalesLabel = items
    .map(a => `${a.nombre ?? a.id}${(a.qty ?? 1) > 1 ? ' × ' + (a.qty ?? 1) : ''}`)
    .join(', ')

  if (snapTotal > 0 || snapServ > 0 || snapAdi > 0) {
    return { servicio: snapServ, adicionales: snapAdi, descuento: snapDesc, total: snapTotal, adicionalesLabel }
  }

  // Fallback en vivo (ficha legacy sin snapshot).
  const peso = parsePeso(c.peso_ingreso) || parsePeso(c.peso_declarado)
  const codigo = c.codigo_servicio || 'CI'
  let tabla: Tramo[] = tablas.convenio
  const explicit = c.tipo_precios
  if (explicit === 'especial') tabla = tablas.especialesDeVet
  else if (explicit === 'general') tabla = tablas.generales
  else if (vetTipoPrecios === 'precios_especiales') tabla = tablas.especialesDeVet
  const tramo = findTramo(tabla, peso)
  const servicio = precioDelTramo(tramo, codigo)
  const adi = items.reduce((s, a) => s + Math.max(0, parseMonto(a.precio)) * Math.max(0, a.qty ?? 1), 0)
  const subtotal = servicio + adi
  let descuento = 0
  const dVal = parseMonto(c.descuento_valor)
  if (dVal > 0) {
    if (c.descuento_tipo === 'fijo') descuento = Math.min(dVal, subtotal)
    else if (c.descuento_tipo === 'variable') descuento = Math.round(subtotal * dVal / 100)
  }
  return {
    servicio: Math.round(servicio),
    adicionales: Math.round(adi),
    descuento: Math.round(descuento),
    total: Math.round(Math.max(0, subtotal - descuento)),
    adicionalesLabel,
  }
}
