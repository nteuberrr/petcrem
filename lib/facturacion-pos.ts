import { getSheetData, ensureSheet, ensureColumns, appendRow, updateRow } from './datastore'
import { formatDateForSheet } from './dates'
import { agregarDiasHabiles, isoFecha } from './dias-habiles'
import { calcularPrecioFicha, type Tramo } from './ficha-precio'
import { parseDecimalOr0 } from './numbers'
import { cobroPasaPorProcesador } from './cobros'

/**
 * VENTAS POS — lo que el procesador de pagos (TUU/Haulmer) nos tiene que abonar.
 *
 * Entran solo las ventas cobradas con MÁQUINA o LINK DE PAGO: transferencia y
 * efectivo no pagan comisión, así que no son parte del abono. De cada venta se
 * descuenta la comisión del contrato:
 *
 *     comisión neta  = fija + variable % × total cobrado (bruto, con IVA)
 *     comisión bruta = comisión neta × (1 + IVA)
 *     liquidado      = total cobrado − comisión bruta
 *
 * El día de la venta lo manda `clientes.fecha_pago` (cuándo se cobró de verdad).
 * Las fichas viejas no la tienen todavía, así que como respaldo se usa la fecha
 * de emisión del documento — esas filas van marcadas con `fecha_estimada` para
 * que no se lean como dato duro.
 *
 * PAGO PARCIAL: por la máquina pasó SOLO EL ABONO. El saldo se recibe siempre
 * por transferencia (confirmado por el dueño, 2026-08-07), así que no es plata
 * del procesador y se descuenta del bruto. Por eso la ficha entra también
 * estando en 'parcial' —el abono ya se cobró— y cuando el saldo se confirma no
 * cambia nada: el monto y el día siguen siendo los del abono.
 *
 * EUTANASIA A DOMICILIO: si la ficha tiene una asociada, su valor SE SUMA al
 * bruto. La eutanasia no va en la boleta (`SE_DOCUMENTA` en lib/eerr-ingresos:
 * se cobra aparte), pero el tutor la paga en la MISMA tarjeta junto con la
 * cremación — así que sí pasó por la máquina, el procesador cobró comisión sobre
 * ella y Haulmer la tiene que abonar. Leerla solo del documento dejaba el abono
 * corto todos los meses. Ojo con la diferencia: la conciliación con el SII sigue
 * sin contarla (ahí lo que se compara es lo boleteado), esto es plata del POS.
 *
 * Haulmer abona al DÍA HÁBIL SIGUIENTE, así que lo del viernes, sábado y domingo
 * llega junto el lunes. Eso lo resuelve `agregarDiasHabiles(dia, 1)`, que además
 * salta los feriados.
 */

const SHEET_CONFIG = 'config_pos'
const CONFIG_COLS = ['id', 'comision_fija', 'comision_variable', 'iva', 'fecha_actualizacion']

/** Contrato vigente a ago-2026: $65 por transacción + 0,79% del total, + IVA. */
export const CONFIG_POS_DEFAULT: ConfigPos = { comision_fija: 65, comision_variable: 0.79, iva: 19 }

/** Formas de pago que pasan por el procesador (las demás no tienen comisión). */
const PAGOS_CON_COMISION = new Set(['pos', 'link'])

export interface ConfigPos {
  /** Pesos fijos por transacción (neto). */
  comision_fija: number
  /** Porcentaje sobre el total cobrado (neto). */
  comision_variable: number
  /** IVA que se le suma a la comisión, en porcentaje. */
  iva: number
}

export interface VentaPos {
  id: string
  codigo: string
  nombre_mascota: string
  /** ISO. Fecha de retiro de la ficha (referencia, no es la del cobro). */
  fecha_retiro: string
  /** ISO. Emisión de la boleta/factura ('' si aún no se emite). */
  fecha_boleta: string
  folio: string
  tipo_pago: 'pos' | 'link'
  /** Lo que pasó por la máquina: total cobrado con IVA, sin el saldo por transferencia. */
  bruto: number
  /** Saldo de un pago parcial descontado del bruto (0 si no hubo). */
  saldo_excluido: number
  /** Parte del bruto que corresponde a la eutanasia a domicilio (0 si no hubo). */
  eutanasia: number
  comision_neta: number
  comision_iva: number
  comision_bruta: number
  /** Lo que Haulmer debería abonar por esta venta. */
  liquidado: number
  /** true si el día salió del documento porque la ficha no tiene fecha de pago. */
  fecha_estimada: boolean
  /**
   * Esta línea NO es la venta de la ficha sino un COBRO POSTERIOR cobrado con
   * máquina o link (el saldo de un parcial, un adicional, una diferencia de
   * peso). Va como línea propia y fechada el día en que se confirmó, porque ese
   * —y no el del retiro— es el día en que pasó por el procesador.
   */
  cobro?: 'saldo' | 'adicional' | 'diferencia'
}

export interface DiaPos {
  /** ISO del día de cobro. */
  fecha: string
  /** ISO del día hábil siguiente: cuándo lo abona Haulmer. */
  fecha_abono: string
  ventas: VentaPos[]
  bruto: number
  comision_neta: number
  comision_bruta: number
  /** Total que debería llegar por este día. */
  liquidado: number
}

/** Redondeo a peso: los montos en CLP no llevan decimales. */
function clp(n: number): number {
  return Math.round(n)
}

function num(v: unknown, porDefecto = 0): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : porDefecto
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(',', '.'))
    return Number.isFinite(n) ? n : porDefecto
  }
  return porDefecto
}

export interface ComisionCalculada {
  comision_neta: number
  comision_iva: number
  comision_bruta: number
  liquidado: number
}

/**
 * Comisión de UNA transacción. El fijo y el porcentaje son netos y el IVA se
 * aplica sobre la suma de los dos, que es como lo cobra el procesador.
 */
export function calcularComision(bruto: number, cfg: ConfigPos): ComisionCalculada {
  const neta = clp(cfg.comision_fija + (bruto * cfg.comision_variable) / 100)
  const bruta = clp(neta * (1 + cfg.iva / 100))
  return {
    comision_neta: neta,
    comision_iva: bruta - neta,
    comision_bruta: bruta,
    liquidado: bruto - bruta,
  }
}

/** Lee la configuración de comisiones (los valores del contrato si no hay fila). */
export async function getConfigPos(): Promise<ConfigPos> {
  try {
    const rows = await getSheetData(SHEET_CONFIG)
    const row = rows.find(r => String(r.id) === '1') ?? rows[0]
    if (!row) return { ...CONFIG_POS_DEFAULT }
    return {
      comision_fija: num(row.comision_fija, CONFIG_POS_DEFAULT.comision_fija),
      comision_variable: num(row.comision_variable, CONFIG_POS_DEFAULT.comision_variable),
      iva: num(row.iva, CONFIG_POS_DEFAULT.iva),
    }
  } catch {
    return { ...CONFIG_POS_DEFAULT }
  }
}

/** Persiste la configuración (fila única id=1). */
export async function setConfigPos(cfg: ConfigPos, hoyISO: string): Promise<void> {
  await ensureSheet(SHEET_CONFIG)
  await ensureColumns(SHEET_CONFIG, CONFIG_COLS)
  const campos = {
    comision_fija: String(Math.max(0, cfg.comision_fija)),
    comision_variable: String(Math.max(0, cfg.comision_variable)),
    iva: String(Math.max(0, cfg.iva)),
    fecha_actualizacion: hoyISO,
  }
  const rows = await getSheetData(SHEET_CONFIG)
  const idx = rows.findIndex(r => String(r.id) === '1')
  if (idx === -1) await appendRow(SHEET_CONFIG, { id: '1', ...campos })
  else await updateRow(SHEET_CONFIG, idx, { ...rows[idx], ...campos })
}

/** Documento tributario de la ficha, sea boleta al tutor o factura al vet. */
interface DocMin { fecha_emision: string; folio: string; monto_total: number }

async function mapaDocumentos(): Promise<Map<string, DocMin>> {
  const docs = await getSheetData('documentos_tributarios')
  const m = new Map<string, DocMin>()
  for (const d of docs) {
    // Los anulados no se cobraron: no aportan ni monto ni fecha.
    if (String(d.estado || '') === 'anulado') continue
    m.set(String(d.id), {
      fecha_emision: formatDateForSheet(d.fecha_emision) || '',
      folio: String(d.folio || ''),
      monto_total: parseInt(String(d.monto_total || '0'), 10) || 0,
    })
  }
  return m
}

/**
 * Ficha → saldo de pago parcial, pagado o no. Es plata que llega por
 * TRANSFERENCIA, así que se descuenta del bruto: por la máquina solo pasó el
 * abono. Se suman también los ya pagados —la fila sobrevive al cierre— porque si
 * no, confirmar el saldo haría aparecer de golpe el total completo.
 */
async function saldosPorFicha(): Promise<Map<string, number>> {
  const m = new Map<string, number>()
  const cobros = await getSheetData('cobros').catch(() => [])
  for (const c of cobros) {
    if (String(c.tipo || '') !== 'saldo') continue
    const id = String(c.cliente_id || '')
    if (!id) continue
    m.set(id, (m.get(id) ?? 0) + (parseDecimalOr0(c.monto) || 0))
  }
  return m
}

/**
 * Ficha → valor de su eutanasia a domicilio, con la MISMA regla que usa la ficha
 * en /clientes (`cobroClienteCon`: precio + recargo fuera de horario, o la
 * consulta si no se realizó; 0 si se canceló). La config se lee UNA vez y el
 * cálculo va en memoria — nunca un await por cotización dentro del loop.
 */
async function eutanasiasPorFicha(): Promise<Map<string, number>> {
  const m = new Map<string, number>()
  try {
    const cotis = await getSheetData('cotizaciones_eutanasia')
    const conFicha = cotis.filter(c => String(c.cliente_id || '').trim())
    if (!conFicha.length) return m
    const { getConfigCobroEutanasia, cobroClienteCon } = await import('./eutanasia-precios')
    const cfg = await getConfigCobroEutanasia()
    for (const cot of conFicha) {
      const total = cobroClienteCon(cot, cfg).total
      if (total > 0) {
        const id = String(cot.cliente_id)
        m.set(id, (m.get(id) ?? 0) + total)
      }
    }
  } catch (e) {
    console.warn('[facturacion-pos] no se pudo calcular el valor de las eutanasias:', e)
  }
  return m
}

async function cargarTablas(): Promise<{ g: Tramo[]; c: Tramo[] }> {
  const [generales, convenio] = await Promise.all([
    getSheetData('precios_generales'),
    getSheetData('precios_convenio'),
  ])
  return { g: generales as unknown as Tramo[], c: convenio as unknown as Tramo[] }
}

export interface FiltrosPos {
  /** ISO inclusive. */
  desde?: string
  /** ISO inclusive. */
  hasta?: string
}

export interface ResumenPos {
  config: ConfigPos
  dias: DiaPos[]
  /** Ventas que no se pueden fechar: sin fecha de pago y sin documento emitido. */
  sin_fecha: VentaPos[]
  totales: { ventas: number; bruto: number; comision_bruta: number; liquidado: number }
}

/**
 * Arma el resumen día por día. `hoyISO` entra por parámetro para que la función
 * no dependa del reloj (mismo criterio que el motor de remuneraciones).
 */
/**
 * Cobros POSTERIORES que se recibieron con MÁQUINA o LINK: el saldo de un pago
 * parcial, un adicional pedido después, una diferencia de peso. Hasta 2026-08-18
 * se daba por hecho que todo eso llegaba por transferencia y quedaba fuera de la
 * conciliación; ahora el equipo elige el medio al confirmar el cobro, y los que
 * pasaron por el procesador tienen que aparecer acá: pagan comisión y llegan en
 * el abono como cualquier otra venta.
 *
 * Van como línea PROPIA, no sumadas a la venta de la ficha, porque ocurren otro
 * día: la ficha se fecha con el abono (día del retiro) y el cobro con el día en
 * que se confirmó. Mezclarlos descuadraría los dos días.
 */
async function cobrosDelProcesador(
  clientesPorId: Map<string, Record<string, string>>,
  config: ConfigPos,
): Promise<Array<{ dia: string; venta: VentaPos }>> {
  const cobros = await getSheetData('cobros').catch(() => [] as Record<string, string>[])
  const out: Array<{ dia: string; venta: VentaPos }> = []
  for (const cb of cobros) {
    if (String(cb.estado || '') !== 'pagado') continue
    if (!cobroPasaPorProcesador(cb.medio_pago)) continue
    const tipo = String(cb.tipo || '')
    if (tipo === 'devolucion') continue   // plata que SALE, no una venta
    const bruto = parseDecimalOr0(cb.monto) || 0
    if (bruto <= 0) continue
    const dia = formatDateForSheet(cb.fecha_pagado) || ''
    if (!dia) continue
    const ficha = clientesPorId.get(String(cb.cliente_id || ''))
    out.push({ dia, venta: {
      id: `cobro-${cb.id}`,
      codigo: String(ficha?.codigo || ''),
      nombre_mascota: String(ficha?.nombre_mascota || ''),
      fecha_retiro: formatDateForSheet(ficha?.fecha_retiro) || '',
      fecha_boleta: '',
      folio: '',
      tipo_pago: String(cb.medio_pago).toLowerCase() === 'link' ? 'link' : 'pos',
      bruto,
      saldo_excluido: 0,
      eutanasia: 0,
      ...calcularComision(bruto, config),
      fecha_estimada: false,
      cobro: (tipo === 'saldo' || tipo === 'adicional' || tipo === 'diferencia') ? tipo : 'adicional',
    } })
  }
  return out
}

export async function resumenVentasPos(f: FiltrosPos = {}): Promise<ResumenPos> {
  const [clientes, tablas, docs, config, saldos, eutanasias] = await Promise.all([
    getSheetData('clientes'),
    cargarTablas(),
    mapaDocumentos(),
    getConfigPos(),
    saldosPorFicha(),
    eutanasiasPorFicha(),
  ])

  const conFecha: VentaPos[] = []
  const sinFecha: VentaPos[] = []
  const porDia = new Map<string, VentaPos[]>()

  for (const c of clientes) {
    const tipo = String(c.tipo_pago || '').trim().toLowerCase()
    if (!PAGOS_CON_COMISION.has(tipo)) continue
    // 'parcial' entra igual: el abono ya pasó por la máquina (ver cabecera).
    const estadoPago = String(c.estado_pago || '').trim().toLowerCase()
    if (estadoPago !== 'pagado' && estadoPago !== 'parcial') continue
    // Un borrador no es una venta todavía.
    if (String(c.estado || '') === 'borrador' || !String(c.codigo || '').trim()) continue

    // El documento puede colgar de la boleta al tutor o de la factura al vet.
    const docId = String(c.boleta_id || '').trim() || String(c.factura_vet_id || '').trim()
    const doc = docId ? docs.get(docId) ?? null : null

    // Monto: manda el documento emitido (es el hecho tributario y ya no cambia);
    // si no hay, el precio congelado de la ficha. Mismo criterio que Ventas.
    // Del total se saca el saldo del parcial: eso llegó por transferencia.
    const precio = calcularPrecioFicha(c, undefined, { generales: tablas.g, convenio: tablas.c, especialesDeVet: [] })
    const cobrado = doc && doc.monto_total > 0 ? doc.monto_total : precio.total
    const saldo = Math.min(saldos.get(String(c.id)) ?? 0, cobrado)
    // La eutanasia va fuera de la boleta pero por la misma tarjeta: suma al bruto
    // DESPUÉS del saldo (el parcial es un abono de la cremación) y por eso también
    // paga comisión. Es la única parte del cobro que el documento no refleja.
    const eutanasia = eutanasias.get(String(c.id)) ?? 0
    const bruto = cobrado - saldo + eutanasia
    if (bruto <= 0) continue

    const fechaPago = formatDateForSheet(c.fecha_pago) || ''
    const fechaDoc = doc?.fecha_emision || ''
    const dia = fechaPago || fechaDoc

    const venta: VentaPos = {
      id: String(c.id),
      codigo: String(c.codigo || ''),
      nombre_mascota: String(c.nombre_mascota || ''),
      fecha_retiro: formatDateForSheet(c.fecha_retiro) || '',
      fecha_boleta: fechaDoc,
      folio: doc?.folio || '',
      tipo_pago: tipo === 'link' ? 'link' : 'pos',
      bruto,
      saldo_excluido: saldo,
      eutanasia,
      ...calcularComision(bruto, config),
      fecha_estimada: !fechaPago && !!fechaDoc,
    }

    if (!dia) { sinFecha.push(venta); continue }
    if (f.desde && dia < f.desde) continue
    if (f.hasta && dia > f.hasta) continue
    conFecha.push(venta)
    const arr = porDia.get(dia)
    if (arr) arr.push(venta); else porDia.set(dia, [venta])
  }

  // Cobros posteriores cobrados con máquina o link: van al día en que se
  // confirmaron, como su propia línea. No hay doble conteo con la ficha: el
  // saldo de un parcial SIEMPRE se descuenta de su bruto (ver saldosPorFicha),
  // se haya cobrado como se haya cobrado.
  const clientesPorId = new Map(clientes.map(c => [String(c.id), c]))
  for (const { dia, venta } of await cobrosDelProcesador(clientesPorId, config)) {
    if (f.desde && dia < f.desde) continue
    if (f.hasta && dia > f.hasta) continue
    conFecha.push(venta)
    const arr = porDia.get(dia)
    if (arr) arr.push(venta); else porDia.set(dia, [venta])
  }

  const dias: DiaPos[] = [...porDia.entries()]
    .map(([fecha, ventas]) => {
      ventas.sort((a, b) => a.codigo.localeCompare(b.codigo))
      const [y, m, d] = fecha.split('-').map(Number)
      return {
        fecha,
        fecha_abono: isoFecha(agregarDiasHabiles(new Date(y, m - 1, d, 12, 0, 0), 1)),
        ventas,
        bruto: ventas.reduce((s, v) => s + v.bruto, 0),
        comision_neta: ventas.reduce((s, v) => s + v.comision_neta, 0),
        comision_bruta: ventas.reduce((s, v) => s + v.comision_bruta, 0),
        liquidado: ventas.reduce((s, v) => s + v.liquidado, 0),
      }
    })
    .sort((a, b) => b.fecha.localeCompare(a.fecha))   // más reciente primero

  sinFecha.sort((a, b) => a.codigo.localeCompare(b.codigo))

  return {
    config,
    dias,
    sin_fecha: sinFecha,
    totales: {
      ventas: conFecha.length,
      bruto: conFecha.reduce((s, v) => s + v.bruto, 0),
      comision_bruta: conFecha.reduce((s, v) => s + v.comision_bruta, 0),
      liquidado: conFecha.reduce((s, v) => s + v.liquidado, 0),
    },
  }
}
