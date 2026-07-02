import { getSheetData, ensureSheet, ensureColumns, appendRow, updateRow } from './datastore'
import { findTramo } from './tramos'

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
const CONFIG_COLS = ['id', 'fijo', 'consulta_vet', 'consulta_alma']

// Defaults de la consulta (cuando la eutanasia NO se realiza): $30.000 al vet +
// $10.000 spread Alma = $40.000 al cliente. Se usan si la config aún no existe.
const CONSULTA_VET_DEFAULT = 30000
const CONSULTA_ALMA_DEFAULT = 10000

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
