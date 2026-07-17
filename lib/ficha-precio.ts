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

/**
 * Calcula el precio de una ficha de cliente. El 2º argumento queda por
 * compatibilidad de firma pero YA NO decide el tramo: la regla usa la EXISTENCIA
 * de filas de precios especiales del vet (tablas.especialesDeVet) + si la ficha
 * tiene veterinaria_id. (Los callers pasan vet.tipo_precios; se ignora.)
 */
export function calcularPrecioFicha(
  c: Record<string, string>,
  _vetTipoPrecios: string | undefined,
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

  const esVet = !!String(c.veterinaria_id || '').trim()
  const tieneSnapshot = snapTotal > 0 || snapServ > 0 || snapAdi > 0

  // TUTOR con snapshot → precio de VENTA CONGELADO (su boleta no debe cambiar).
  if (!esVet && tieneSnapshot) {
    return { servicio: snapServ, adicionales: snapAdi, descuento: snapDesc, total: snapTotal, adicionalesLabel }
  }

  // Servicio EN VIVO con el tier que corresponde HOY (regla del dueño): ficha de
  // CONVENIO (tiene veterinaria_id) → ESPECIAL si el vet tiene filas especiales, si
  // no CONVENIO; ficha de TUTOR → GENERAL. La existencia de filas especiales manda.
  const peso = parsePeso(c.peso_ingreso) || parsePeso(c.peso_declarado)
  const codigo = c.codigo_servicio || 'CI'
  let tabla: Tramo[] = tablas.generales
  if (esVet) {
    tabla = tablas.especialesDeVet.length > 0 ? tablas.especialesDeVet : tablas.convenio
  } else if (c.tipo_precios === 'especial') {
    tabla = tablas.especialesDeVet.length > 0 ? tablas.especialesDeVet : tablas.convenio
  } else if (c.tipo_precios === 'convenio') {
    tabla = tablas.convenio
  }
  const servicio = precioDelTramo(findTramo(tabla, peso), codigo)

  // VET con snapshot → recomputar SOLO el servicio con el tier actual; conservar
  // adicionales y descuento congelados. Corrige el tier viejo (ej. Cooldogs, que se
  // pasó de convenio a especial después de crear la ficha) sin recalcular el resto.
  if (esVet && tieneSnapshot) {
    return {
      servicio: Math.round(servicio),
      adicionales: snapAdi,
      descuento: snapDesc,
      total: Math.round(Math.max(0, servicio + snapAdi - snapDesc)),
      adicionalesLabel,
    }
  }

  // Legacy SIN snapshot (tutor o vet): recomputar TODO en vivo.
  const adi = items.reduce((s, a) => s + Math.max(0, parseMonto(a.precio)) * Math.max(0, a.qty ?? 1), 0)
  // Descuento SOLO sobre el servicio de cremación, nunca sobre los adicionales.
  let descuento = 0
  const dVal = parseMonto(c.descuento_valor)
  if (dVal > 0) {
    if (c.descuento_tipo === 'fijo') descuento = Math.min(dVal, servicio)
    else if (c.descuento_tipo === 'variable') descuento = Math.round(servicio * dVal / 100)
  }
  return {
    servicio: Math.round(servicio),
    adicionales: Math.round(adi),
    descuento: Math.round(descuento),
    total: Math.round(Math.max(0, servicio + adi - descuento)),
    adicionalesLabel,
  }
}
