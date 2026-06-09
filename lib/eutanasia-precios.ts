import { getSheetData, ensureSheet, ensureColumns, appendRow, updateRow } from './datastore'

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
const CONFIG_COLS = ['id', 'fijo']

function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(',', '.'))
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

type TramoEut = { peso_min: string; peso_max: string; precio: string }

/** Tramo aplicable con regla de borde hacia arriba (ver price-calculator). */
function findTramoEut(tabla: TramoEut[], peso: number): TramoEut | null {
  if (!tabla.length || !Number.isFinite(peso) || peso <= 0) return null
  let maxMin = -Infinity
  let tramoTope: TramoEut | null = null
  for (const t of tabla) {
    const min = num(t.peso_min)
    if (min > maxMin) { maxMin = min; tramoTope = t }
  }
  if (tramoTope && peso >= maxMin) return tramoTope
  for (const t of tabla) {
    const min = num(t.peso_min)
    const max = num(t.peso_max)
    if (peso >= min && peso < max) return t
  }
  return null
}

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
  await ensureSheet(SHEET_CONFIG)
  await ensureColumns(SHEET_CONFIG, CONFIG_COLS)
  const rows = await getSheetData(SHEET_CONFIG)
  const idx = rows.findIndex(r => r.id === '1')
  const valor = { id: '1', fijo: String(Math.max(0, Math.round(fijo))) }
  if (idx === -1) {
    await appendRow(SHEET_CONFIG, valor)
  } else {
    await updateRow(SHEET_CONFIG, idx, { ...rows[idx], ...valor })
  }
}

/** Precio que se le paga al vet para un peso dado (0 si no hay tramo). */
export async function precioVetEutanasia(peso: number): Promise<number> {
  const rows = (await getSheetData(SHEET_PRECIOS)) as unknown as TramoEut[]
  const tramo = findTramoEut(rows, peso)
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
