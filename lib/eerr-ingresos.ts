import { getSheetData } from './datastore'
import { formatDateForSheet } from './dates'
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
 *  - TODOS los ingresos van NETOS (÷1,19). El EERR trabaja neto de IVA y los
 *    números tienen que ser comparables entre sí y contra el SII.
 *  - `eutanasias` es el MARGEN (cobrado al cliente − pagado al vet). Iba BRUTO
 *    porque se cobra fuera de la boleta; se pasó a neto por decisión del dueño
 *    (2026-08-09) para que no fuera la única línea de ingreso en otra unidad.
 *    Sigue SIN documentarse (ver SE_DOCUMENTA), así que no entra en la
 *    comparación contra el SII — pero ahora al menos se muestra en la misma
 *    moneda que el resto.
 *  - La ficha se imputa por `fecha_retiro` (o `fecha_creacion` si falta), NO por la
 *    fecha de la boleta: el ingreso es del mes en que se prestó el servicio.
 *  - Las fichas 'borrador' no son ventas todavía y quedan fuera.
 */

export const IVA = 1.19

/** Las cuatro claves de ingreso; calzan con `eerr_partidas.clave` (tipo 'ingreso'). */
export type ClaveIngreso = 'general' | 'convenio' | 'adicionales' | 'eutanasias'

export type IngresosPorClave = Record<ClaveIngreso, number[]> & {
  /**
   * Parte de esos ingresos que va SIN BOLETA por decisión del dueño (ver
   * `sinBoleta`). Va aparte y no como una quinta clave porque no es un tipo de
   * venta: es la misma venta general/convenio/adicionales, marcada para no
   * documentarse. La Conciliación se la RESTA a lo que debería aparecer en el
   * SII; si no, marcaría una diferencia todos los meses.
   */
  no_documentado: number[]
}

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
  const { clientes, eutanasias, cfgEut, tablaDe } = await cargarBase()

  const general = zeros(), convenio = zeros(), adicionales = zeros(), noDoc = zeros()
  for (const c of clientes) {
    if (c.estado === 'borrador') continue
    const p = periodIdx(c.fecha_retiro || c.fecha_creacion)
    if (p === undefined) continue
    const m = montosDeFicha(c, tablaDe)
    if (m.convenio) convenio[p] += m.serv
    else general[p] += m.serv
    adicionales[p] += m.adic
    if (sinBoleta(c)) noDoc[p] += m.serv + m.adic
  }

  // EUTANASIAS: el ingreso es el MARGEN (cobrado al cliente − pagado al
  // veterinario), imputado al período de la FECHA DEL SERVICIO (no la de
  // confirmación del vet, que llega tarde).
  const eutan = zeros()
  for (const cot of eutanasias) {
    const m = margenEutanasiaCon(cot, cfgEut)
    if (!m) continue
    const p = periodIdx(m.fecha)
    if (p === undefined) continue
    eutan[p] += m.margen / IVA
  }

  return { general, convenio, adicionales, eutanasias: eutan, no_documentado: noDoc }
}

/** Datos y tablas de precio que necesitan tanto el total como el detalle. */
async function cargarBase() {
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
  const tablaDe = (c: Cli): Tramo[] => {
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
  return { clientes: clientes as Cli[], eutanasias: eutanasias as Cli[], cfgEut, tablaDe }
}

/**
 * Reparte una ficha en servicio y adicionales, NETOS. Es la unidad de cálculo que
 * comparten el total (`calcularIngresos`) y el detalle (`detalleIngresos`): si se
 * separan, el desglose deja de sumar el total y la conciliación pierde sentido.
 *
 * El descuento ya viene aplicado en `precio_total`, así que se reparte
 * proporcionalmente entre servicio y adicionales para no descontarle de más a
 * ninguno de los dos.
 */
function montosDeFicha(c: Cli, tablaDe: (c: Cli) => Tramo[]): { serv: number; adic: number; convenio: boolean } {
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
  // SIN BOLETA (el dueño la marcó así): no se emite documento, así que no hay
  // IVA que remesar y la plata que queda es el monto COMPLETO. Dividir por 1,19
  // una venta que nunca pagó IVA subestima el resultado en un 19% de esa venta.
  // Mismo criterio que las eutanasias, que también se cobran fuera de boleta.
  const divisor = sinBoleta(c) ? 1 : IVA
  return {
    serv: (base > 0 ? total * (serv / base) : total) / divisor,
    adic: (base > 0 ? total * (adic / base) : 0) / divisor,
    convenio: esConvenio(c),
  }
}

/**
 * ¿La ficha se cobró SIN emitir boleta? Es una decisión explícita del dueño,
 * marcada en la ficha (checkbox que solo él ve). Cambia tres cosas:
 *   · no se emite la boleta al marcarla pagada;
 *   · no aparece en "Pagadas sin boleta" (no es un olvido);
 *   · en la Conciliación NO cuenta como diferencia: el SII no debería tenerla.
 * El ingreso sí se registra, y en BRUTO (ver arriba).
 */
export function sinBoleta(c: { sin_boleta?: string }): boolean {
  return String(c.sin_boleta ?? '').toUpperCase() === 'TRUE'
}

/** Una línea del desglose: de dónde sale el monto y si tiene respaldo tributario. */
export interface ItemIngreso {
  clave: ClaveIngreso
  /** id de la ficha (clientes) o de la cotización de eutanasia. */
  id: string
  codigo: string
  nombre: string
  fecha: string
  monto: number
  /** ¿Tiene documento tributario emitido? Las eutanasias nunca (no se documentan). */
  documentado: boolean
  /** Etiqueta del documento ("Boleta 10234"), o el motivo de que no haya. */
  documento: string
  /** Quién emitió el documento: nosotros, el POS (TUU) o nadie. */
  origen: 'sistema' | 'pos' | 'ninguno'
  /** Veterinario que derivó la ficha (solo en la clave `convenio`). */
  vet?: string
}

const ETIQUETA_DTE: Record<string, string> = { '39': 'Boleta', '41': 'Boleta exenta', '33': 'Factura', '34': 'Factura exenta', '61': 'Nota de crédito' }

/**
 * DESGLOSE de un período: cada ficha/cotización que compone cada clave de
 * ingreso, con su monto neto y si quedó documentada. Es lo que abre el «+» del
 * cuadro del sistema en la Conciliación — sirve para pasar de "faltan $3M" a
 * "estas 34 fichas no tienen boleta".
 */
export async function detalleIngresos(periodo: string): Promise<ItemIngreso[]> {
  const { clientes, eutanasias, cfgEut, tablaDe } = await cargarBase()
  const [docs, vets] = await Promise.all([
    getSheetData('documentos_tributarios'),
    getSheetData('veterinarios'),
  ])
  const docById = new Map(docs.map(d => [String(d.id), d]))
  const vetById = new Map(vets.map(v => [String(v.id), v.nombre || v.razon_social || '']))
  const enPeriodo = (iso: string) => (formatDateForSheet(iso) || '').slice(0, 7) === periodo

  /**
   * Documento asociado a la ficha. Tres orígenes posibles, y confundirlos genera
   * falsos positivos:
   *  - `sistema`: boleta o factura que emitimos nosotros (documentos_tributarios).
   *  - `pos`: la venta se pagó con el POS y la boleta la emitió TUU directamente,
   *    así que NO existe en documentos_tributarios pero SÍ llega al SII. Marcarla
   *    como "sin documento" era el error: pasaba con las fichas cuya boleta
   *    nuestra se anuló justamente por duplicar la del POS.
   *  - `ninguno`: no hay respaldo por ninguna vía.
   */
  const documentoDe = (c: Cli): { ok: boolean; label: string; origen: ItemIngreso['origen'] } => {
    for (const campo of ['boleta_id', 'factura_vet_id']) {
      const id = String(c[campo] || '').trim()
      if (!id) continue
      const d = docById.get(id)
      if (!d) continue
      if (String(d.estado || '') === 'anulado') break // anulada → puede quedar cubierta por el POS
      return { ok: true, label: `${ETIQUETA_DTE[d.tipo_dte] || 'Documento'} ${d.folio}`, origen: 'sistema' }
    }
    if (String(c.tipo_pago || '').toLowerCase() === 'pos') {
      return { ok: true, label: 'Boleta del POS (TUU)', origen: 'pos' }
    }
    // Marcada SIN BOLETA por el dueño: no es un olvido, es una decisión. Cuenta
    // como resuelta para que no ensucie el listado de "faltan documentos".
    if (sinBoleta(c)) return { ok: true, label: 'Sin boleta (decisión)', origen: 'ninguno' }
    return { ok: false, label: 'Sin documento', origen: 'ninguno' }
  }

  const out: ItemIngreso[] = []
  for (const c of clientes) {
    if (c.estado === 'borrador') continue
    if (!enPeriodo(c.fecha_retiro || c.fecha_creacion)) continue
    const m = montosDeFicha(c, tablaDe)
    const doc = documentoDe(c)
    const base = {
      id: String(c.id), codigo: c.codigo || '', nombre: c.nombre_mascota || '',
      fecha: formatDateForSheet(c.fecha_retiro || c.fecha_creacion) || '',
      documentado: doc.ok, documento: doc.label, origen: doc.origen,
      ...(m.convenio ? { vet: vetById.get(String(c.veterinaria_id || '')) || '' } : {}),
    }
    if (Math.round(m.serv) !== 0) out.push({ ...base, clave: m.convenio ? 'convenio' : 'general', monto: Math.round(m.serv) })
    if (Math.round(m.adic) !== 0) out.push({ ...base, clave: 'adicionales', monto: Math.round(m.adic) })
  }
  for (const cot of eutanasias) {
    const m = margenEutanasiaCon(cot, cfgEut)
    if (!m || !enPeriodo(m.fecha)) continue
    out.push({
      clave: 'eutanasias', id: String(cot.id), codigo: '',
      nombre: cot.mascota_nombre || cot.cliente_nombre || '',
      fecha: formatDateForSheet(m.fecha) || '',
      monto: Math.round(m.margen / IVA),
      // La comisión se cobra fuera de la boleta: no es un descuadre, es el modelo.
      documentado: false, documento: 'Se cobra fuera de boleta', origen: 'ninguno',
    })
  }
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.codigo.localeCompare(b.codigo))
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
