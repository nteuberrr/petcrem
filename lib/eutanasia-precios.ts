import { getSheetData, ensureSheet, ensureColumns, appendRow, updateRow } from './datastore'
import { findTramo } from './tramos'
import { esFueraDeHorario } from './adicionales-auto'

// ─────────────────────────────────────────────────────────────────────────────
// Precios del servicio de eutanasia a domicilio.
//
// Dos componentes:
//   1. precio del VET   → tabla `precios_eutanasia`, por tramo de peso (lo que se
//                         le paga al veterinario por el servicio). Es el mismo
//                         valor que se congela como `precio_snapshot` en la cotización.
//   2. fijo del CLIENTE → `config_eutanasia.fijo`, cargo único configurable que se
//                         SUMA al precio del vet para dar el precio que se le cobra
//                         al cliente final.
//
//   precio_cliente(peso) = precio_vet(peso) + fijo
//
// El tramo se resuelve con la MISMA regla de borde que lib/price-calculator:
// intervalos [min, max), y en el límite exacto gana el tramo MAYOR.
// ─────────────────────────────────────────────────────────────────────────────

const SHEET_PRECIOS = 'precios_eutanasia'
const SHEET_CONFIG = 'config_eutanasia'
const CONFIG_COLS = ['id', 'fijo', 'consulta_vet', 'consulta_alma', 'recargo_fuera_horario']

// Defaults de la consulta (cuando la eutanasia NO se realiza): $30.000 al vet +
// $10.000 spread Alma = $40.000 al cliente. Se usan si la config aún no existe.
const CONSULTA_VET_DEFAULT = 30000
const CONSULTA_ALMA_DEFAULT = 10000

// Recargo por servicio FUERA DE HORARIO (fin de semana, feriado o desde las 18:00
// L-V), que se le cobra al cliente por la eutanasia a domicilio. Se cobra UNA sola
// vez, junto con la eutanasia y SIEMPRE fuera de la boleta (que cubre solo la
// cremación); si además hay cremación, la ficha NO vuelve a sumar su propio
// recargo de retiro fuera de horario. Aplica se realice o no la eutanasia.
export const RECARGO_FUERA_HORARIO_DEFAULT = 10000

function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(',', '.'))
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

type TramoEut = { peso_min: string; peso_max: string; precio: string }

/** Lee el cargo fijo configurado (0 si no hay config o la hoja no existe). */
export async function getFijoEutanasia(): Promise<number> {
  try {
    const rows = await getSheetData(SHEET_CONFIG)
    const row = rows.find(r => r.id === '1') ?? rows[0]
    return row ? num(row.fijo) : 0
  } catch {
    return 0
  }
}

/** Persiste el cargo fijo (fila única id=1). Crea la hoja/columnas si faltan. */
export async function setFijoEutanasia(fijo: number): Promise<void> {
  await guardarConfig({ fijo: String(Math.max(0, Math.round(fijo))) })
}

export interface ConsultaEutanasia {
  /** Monto que se le paga al veterinario por la evaluación si NO se realiza. */
  vet: number
  /** Spread de Alma Animal sobre la consulta. */
  alma: number
  /** Total que se le cobra al cliente si NO se realiza (vet + alma). */
  total: number
}

/**
 * Lee la consulta configurada (cuando la eutanasia NO se realiza). Usa los
 * defaults ($30.000 vet + $10.000 Alma) si no hay config o la hoja no existe.
 */
export async function getConsultaEutanasia(): Promise<ConsultaEutanasia> {
  try {
    const rows = await getSheetData(SHEET_CONFIG)
    const row = rows.find(r => r.id === '1') ?? rows[0]
    const vet = row && row.consulta_vet !== '' && row.consulta_vet != null ? num(row.consulta_vet) : CONSULTA_VET_DEFAULT
    const alma = row && row.consulta_alma !== '' && row.consulta_alma != null ? num(row.consulta_alma) : CONSULTA_ALMA_DEFAULT
    return { vet, alma, total: vet + alma }
  } catch {
    return { vet: CONSULTA_VET_DEFAULT, alma: CONSULTA_ALMA_DEFAULT, total: CONSULTA_VET_DEFAULT + CONSULTA_ALMA_DEFAULT }
  }
}

/** Persiste la consulta (vet + alma) en la fila única id=1. */
export async function setConsultaEutanasia(c: { vet: number; alma: number }): Promise<void> {
  await guardarConfig({
    consulta_vet: String(Math.max(0, Math.round(c.vet))),
    consulta_alma: String(Math.max(0, Math.round(c.alma))),
  })
}

/**
 * Recargo fuera de horario configurado (default $10.000 si no hay config o la
 * columna aún no existe — los reads toleran su ausencia).
 */
export async function getRecargoFueraHorario(): Promise<number> {
  try {
    const rows = await getSheetData(SHEET_CONFIG)
    const row = rows.find(r => r.id === '1') ?? rows[0]
    if (row && row.recargo_fuera_horario !== '' && row.recargo_fuera_horario != null) {
      return num(row.recargo_fuera_horario)
    }
    return RECARGO_FUERA_HORARIO_DEFAULT
  } catch {
    return RECARGO_FUERA_HORARIO_DEFAULT
  }
}

/** Persiste el recargo fuera de horario (fila única id=1). */
export async function setRecargoFueraHorario(monto: number): Promise<void> {
  await guardarConfig({ recargo_fuera_horario: String(Math.max(0, Math.round(monto))) })
}

/**
 * Monto de recargo fuera de horario que corresponde a un servicio de eutanasia
 * agendado para `fecha`/`hora` (0 si cae dentro de horario). El `monto` es el
 * recargo configurado — pásalo desde `getRecargoFueraHorario()` para no leer la
 * config dos veces cuando ya la tienes.
 */
export function recargoEutanasiaPara(fecha: string | undefined, hora: string | undefined, monto: number): number {
  return esFueraDeHorario(fecha, hora) ? Math.max(0, Math.round(monto)) : 0
}

/**
 * Datos de la CREMACIÓN posterior para el correo al tutor (modalidad legible +
 * valor según el peso, con tarifas GENERALES: el tutor es cliente directo).
 * Devuelve undefined si no hay cremación contratada, no hay peso, o no se puede
 * cotizar — en ese caso el correo simplemente omite el bloque.
 * Se muestra SIEMPRE en un bloque aparte del de la eutanasia (son dos cobros).
 */
export async function cremacionParaCorreo(
  peso: number | string | undefined,
  codigoServicio: string | undefined,
): Promise<{ servicio: string; precio: number; esPremium: boolean } | undefined> {
  const cod = String(codigoServicio ?? '').trim().toUpperCase()
  if (!cod || cod === 'NINGUNA') return undefined
  const p = num(peso)
  if (!(p > 0)) return undefined
  try {
    const { calcularPrecio } = await import('./price-calculator')
    const precio = await calcularPrecio(p, cod, 'general')
    if (!(precio > 0)) return undefined
    let servicio = ''
    try {
      const tipos = await getSheetData('tipos_servicio')
      servicio = tipos.find(t => String(t.codigo ?? '').trim().toUpperCase() === cod)?.nombre ?? ''
    } catch { /* cae al nombre por defecto */ }
    if (!servicio) servicio = cod === 'CP' ? 'Cremación Premium' : cod === 'SD' ? 'Cremación Sin Devolución' : 'Cremación Individual'
    const { servicioIncluyeAnforaPremium } = await import('./anforas-premium')
    return { servicio, precio, esPremium: servicioIncluyeAnforaPremium(cod) }
  } catch {
    return undefined
  }
}

/**
 * Las modalidades de cremación con su valor para ese peso (tarifas GENERALES).
 * Se usa cuando el tutor TODAVÍA no eligió modalidad (alta manual del admin): el
 * correo le muestra las opciones para que elija. [] si no se puede cotizar.
 */
export async function cremacionOpcionesParaCorreo(
  peso: number | string | undefined,
): Promise<{ servicio: string; precio: number }[]> {
  const p = num(peso)
  if (!(p > 0)) return []
  try {
    const { calcularPrecio } = await import('./price-calculator')
    let tipos: Record<string, string>[] = []
    try { tipos = await getSheetData('tipos_servicio') } catch { /* nombres por defecto */ }
    const DEFAULTS: Record<string, string> = { CI: 'Cremación Individual', CP: 'Cremación Premium', SD: 'Cremación Sin Devolución' }
    const out: { servicio: string; precio: number }[] = []
    for (const cod of ['CI', 'CP', 'SD']) {
      const precio = await calcularPrecio(p, cod, 'general')
      if (!(precio > 0)) continue
      const nombre = tipos.find(t => String(t.codigo ?? '').trim().toUpperCase() === cod)?.nombre || DEFAULTS[cod]
      out.push({ servicio: nombre, precio })
    }
    return out
  } catch {
    return []
  }
}

/** Upsert de la fila única de config (merge de campos). Crea hoja/columnas si faltan. */
async function guardarConfig(campos: Record<string, string>): Promise<void> {
  await ensureSheet(SHEET_CONFIG)
  await ensureColumns(SHEET_CONFIG, CONFIG_COLS)
  const rows = await getSheetData(SHEET_CONFIG)
  const idx = rows.findIndex(r => r.id === '1')
  if (idx === -1) {
    await appendRow(SHEET_CONFIG, { id: '1', ...campos })
  } else {
    await updateRow(SHEET_CONFIG, idx, { ...rows[idx], ...campos })
  }
}

/** Precio que se le paga al vet para un peso dado (0 si no hay tramo). */
export async function precioVetEutanasia(peso: number): Promise<number> {
  const rows = (await getSheetData(SHEET_PRECIOS)) as unknown as TramoEut[]
  const tramo = findTramo(rows, peso)
  return tramo ? num(tramo.precio) : 0
}

export interface PrecioEutanasiaDesglose {
  /** Lo que se paga al veterinario (tramo de peso). */
  vet: number
  /** Cargo fijo configurable que se suma. */
  fijo: number
  /** Precio final al cliente = vet + fijo. */
  cliente: number
}

/**
 * Desglose completo del precio de eutanasia para un peso: lo que se paga al vet,
 * el fijo configurado y el total al cliente. Una sola pasada por ambas hojas.
 */
export async function precioClienteEutanasia(peso: number): Promise<PrecioEutanasiaDesglose> {
  const [vet, fijo] = await Promise.all([precioVetEutanasia(peso), getFijoEutanasia()])
  return { vet, fijo, cliente: vet + fijo }
}

export interface ValorCotizacionDesglose {
  /** Precio al cliente SIN el recargo fuera de horario (snapshot|tramo + fijo). */
  base: number
  /** Recargo fuera de horario según la fecha/hora del servicio (0 si dentro de horario). */
  recargo: number
  /** Total a cobrar al cliente = base + recargo. Se cobra SIEMPRE fuera de la boleta. */
  total: number
}

type CotValor = { peso?: string; precio_snapshot?: string; fecha_servicio?: string; hora_servicio?: string }

/**
 * Desglose del valor a COBRAR al cliente por una cotización de eutanasia: la base
 * (precio del servicio) y el recargo fuera de horario aparte. La base usa el
 * `precio_snapshot` congelado (lo pactado con el vet) + el fijo vigente; si la
 * cotización no tiene snapshot (legacy), cae a la tabla por peso. El recargo se
 * agrega cuando la fecha/hora del servicio cae fuera de horario (finde, feriado o
 * ≥18:00 L-V) y se cobra junto con la eutanasia, SIEMPRE fuera de la boleta.
 */
export async function desgloseValorCotizacion(cot: CotValor): Promise<ValorCotizacionDesglose> {
  const [fijo, recargoMonto] = await Promise.all([getFijoEutanasia(), getRecargoFueraHorario()])
  const snap = num(cot.precio_snapshot)
  let base = 0
  if (snap > 0) base = snap + fijo
  else {
    const peso = num(cot.peso)
    base = peso > 0 ? (await precioVetEutanasia(peso)) + fijo : 0
  }
  if (base <= 0) return { base: 0, recargo: 0, total: 0 }
  const recargo = recargoEutanasiaPara(cot.fecha_servicio, cot.hora_servicio, recargoMonto)
  return { base, recargo, total: base + recargo }
}

/**
 * Valor total a COBRAR al cliente por una cotización de eutanasia (base + recargo
 * fuera de horario). Es el que la ficha de cremación asociada muestra como "fuera
 * de boleta" y el que se suma al total a cobrar del retiro.
 */
export async function valorClienteCotizacion(cot: CotValor): Promise<number> {
  return (await desgloseValorCotizacion(cot)).total
}

/**
 * Valor de eutanasia A COBRAR asociado a una ficha de cremación (0 si la ficha
 * no vino de una eutanasia, o si la cotización quedó cancelada/no realizada).
 * Es el monto que se suma al "total a cobrar" del retiro — SIEMPRE fuera de la
 * boleta (que cubre solo la cremación). Best-effort.
 */
export async function valorEutanasiaPorCliente(clienteId: string): Promise<number> {
  if (!clienteId) return 0
  try {
    const cotis = await getSheetData('cotizaciones_eutanasia')
    const cot = cotis.find(c =>
      String(c.cliente_id) === String(clienteId) &&
      !['cancelada', 'no_realizada'].includes(String(c.estado || ''))
    )
    return cot ? await valorClienteCotizacion(cot) : 0
  } catch { return 0 }
}
