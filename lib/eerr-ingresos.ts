import { getSheetData } from './datastore'
import { parseDecimalOr0, parsePeso } from './numbers'
import { findTramo, precioDelTramo } from './tramos'
import { getConfigCobroEutanasia, margenEutanasiaCon } from './eutanasia-precios'

/**
 * INGRESOS del negocio, por tipo y por período. Fuente ÚNICA — la comparten el
 * EERR Integral (`/api/eerr/integral`, 12 meses o un período) y la Conciliación
 * del SII (`/api/facturacion/conciliacion`, un mes).
 *
 * Vivía embebido en el route del EERR; se extrajo cuando la Conciliación necesitó
 * "lo efectivamente vendido según el sistema". Duplicarlo habría garantizado que
 * los dos números se separaran con el primer cambio de reglas, y justo la gracia
 * de la conciliación es que el de la izquierda (SII) y el de la derecha (nosotros)
 * sean comparables.
 *
 * Convenciones que NO son obvias:
 *  - `general`/`convenio`/`adicionales` van NETOS (÷1,19): son ventas boleteadas
 *    o facturadas, y el EERR trabaja neto de IVA.
 *  - `eutanasias` es el MARGEN (cobrado al cliente − pagado al vet) y va BRUTO: se
 *    cobra FUERA de la boleta, así que no lleva la división por IVA. Por lo mismo,
 *    en la conciliación NO debe aparecer en el lado del SII.
 *  - La ficha se imputa por `fecha_retiro` (o `fecha_creacion` si falta), NO por la
 *    fecha de la boleta: el ingreso es del mes en que se prestó el servicio.
 *  - Las fichas 'borrador' no son ventas todavía y quedan fuera.
 */

export const IVA = 1.19

/** Las cuatro claves de ingreso; calzan con `eerr_partidas.clave` (tipo 'ingreso'). */
export type ClaveIngreso = 'general' | 'convenio' | 'adicionales' | 'eutanasias'

export type IngresosPorClave = Record<ClaveIngreso, number[]>

interface Tramo { id?: string; peso_min: string; peso_max: string; precio_ci: string; precio_cp: string; precio_sd: string; veterinaria_id?: string }
type Cli = Record<string, string>

/**
 * ¿La ficha se cobra a tarifa de convenio? El string `tipo_precios` manda cuando
 * está explícito; si no, decide la existencia de un veterinario asociado.
 */
export function esConvenio(c: Cli): boolean {
  const e = c.tipo_precios
  if (e === 'convenio' || e === 'especial') return true
  if (e === 'general') return false
  return !!c.veterinaria_id
}

export function adicionalesSum(raw: string): number {
  try {
    const items = JSON.parse(raw || '[]') as Array<{ precio?: number; qty?: number }>
    return items.reduce((s, a) => s + Math.max(0, a.precio ?? 0) * Math.max(0, a.qty ?? 1), 0)
  } catch { return 0 }
}

/**
 * `base` = precio del servicio de cremación. El descuento aplica SOLO sobre él,
 * nunca sobre los adicionales (regla del dueño). Para fichas con snapshot se usa
 * el monto ya congelado.
 */
export function descuentoMonto(c: Cli, base: number): number {
  const snap = parseDecimalOr0(c.descuento_monto)
  if (snap > 0) return snap
  const dVal = parseDecimalOr0(c.descuento_valor)
  if (dVal <= 0) return 0
  if (c.descuento_tipo === 'fijo') return Math.min(dVal, base)
  if (c.descuento_tipo === 'variable') return Math.round(base * dVal / 100)
  return 0
}

/**
 * Calcula los ingresos por clave para N períodos.
 *
 * @param periodIdx  mapea una fecha ISO a su índice de período (undefined = fuera de rango)
 * @param n          cantidad de períodos (largo de cada arreglo devuelto)
 */
export async function calcularIngresos(
  periodIdx: (iso: string) => number | undefined,
  n: number,
): Promise<IngresosPorClave> {
  const zeros = () => new Array(n).fill(0)
  const [clientes, pg, pc, pe, eutanasias, cfgEut] = await Promise.all([
    getSheetData('clientes'),
    getSheetData('precios_generales'),
    getSheetData('precios_convenio'),
    getSheetData('precios_especiales'),
    getSheetData('cotizaciones_eutanasia'),
    getConfigCobroEutanasia(),
  ])

  const preciosG = pg as unknown as Tramo[]
  const preciosC = pc as unknown as Tramo[]
  const peByVet = new Map<string, Tramo[]>()
  for (const t of pe as unknown as Tramo[]) {
    const v = t.veterinaria_id ?? ''
    const arr = peByVet.get(v) ?? []; arr.push(t); peByVet.set(v, arr)
  }

  function tablaDe(c: Cli): Tramo[] {
    const e = c.tipo_precios
    if (e === 'convenio') return preciosC
    if (e === 'especial') return peByVet.get(c.veterinaria_id ?? '') ?? []
    if (e === 'general') return preciosG
    if (c.veterinaria_id) {
      // El tier lo decide la EXISTENCIA de filas especiales, no el string
      // `tipo_precios` (un vet indexado a generales lo tiene en 'precios_generales'
      // y sus tramos igual viven en precios_especiales).
      const especialesDeVet = peByVet.get(c.veterinaria_id) ?? []
      return especialesDeVet.length > 0 ? especialesDeVet : preciosC
    }
    return preciosG
  }

  // General/Convenio = servicio de cremación; Adicionales aparte. El descuento ya
  // viene aplicado en `precio_total`, así que se reparte proporcionalmente entre
  // servicio y adicionales para no descontarle de más a ninguno de los dos.
  const general = zeros(), convenio = zeros(), adicionales = zeros()
  for (const c of clientes as Cli[]) {
    if (c.estado === 'borrador') continue
    const p = periodIdx(c.fecha_retiro || c.fecha_creacion)
    if (p === undefined) continue
    let serv = parseDecimalOr0(c.precio_servicio)
    let adic = parseDecimalOr0(c.precio_adicionales)
    let total = parseDecimalOr0(c.precio_total)
    if (!(total > 0 || serv > 0 || adic > 0)) {
      // Ficha legacy sin snapshot → recalcular en vivo con las tablas vigentes.
      const peso = parsePeso(c.peso_ingreso) || parsePeso(c.peso_declarado)
      serv = precioDelTramo(findTramo(tablaDe(c), peso), c.codigo_servicio || 'CI')
      adic = adicionalesSum(c.adicionales)
      total = Math.max(0, serv + adic - descuentoMonto(c, serv))
    }
    const base = serv + adic
    const servShare = base > 0 ? total * (serv / base) : total
    const adicShare = base > 0 ? total * (adic / base) : 0
    if (esConvenio(c)) convenio[p] += servShare / IVA
    else general[p] += servShare / IVA
    adicionales[p] += adicShare / IVA
  }

  // EUTANASIAS a domicilio: el ingreso es el MARGEN (cobrado al cliente − pagado
  // al veterinario), porque el servicio lo presta el vet y su pago se traspasa
  // completo. Se imputa al período de la FECHA DEL SERVICIO (no la de confirmación
  // del vet, que llega tarde) y va BRUTO (se cobra fuera de la boleta).
  const eutan = zeros()
  for (const cot of eutanasias as Cli[]) {
    const m = margenEutanasiaCon(cot, cfgEut)
    if (!m) continue
    const p = periodIdx(m.fecha)
    if (p === undefined) continue
    eutan[p] += m.margen
  }

  return { general, convenio, adicionales, eutanasias: eutan }
}

/** Etiquetas de cara al usuario para cada clave de ingreso. */
export const LABEL_INGRESO: Record<ClaveIngreso, string> = {
  general: 'Venta general',
  convenio: 'Venta veterinarias',
  adicionales: 'Adicionales',
  eutanasias: 'Comisión eutanasias',
}

/**
 * ¿Esta clave debería tener respaldo tributario (boleta/factura) en el SII?
 * Las eutanasias NO: se cobran fuera de la boleta y lo que registramos es el
 * margen. Sin esta distinción la conciliación marcaría una diferencia falsa todos
 * los meses.
 */
export const SE_DOCUMENTA: Record<ClaveIngreso, boolean> = {
  general: true,
  convenio: true,
  adicionales: true,
  eutanasias: false,
}
