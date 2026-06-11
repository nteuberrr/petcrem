import * as sheets from './google-sheets'
import { getSupabase } from './supabase'
import { SHEETS } from './sheets-schema'

// ─────────────────────────────────────────────────────────────────────────────
// Capa de datos con DOBLE BACKEND. Mantiene las mismas firmas que lib/google-sheets
// para que migrar una ruta sea cambiar el import (no reescribir lógica). El backend
// se elige por entorno:
//
//   DATA_BACKEND = 'sheets' (default) | 'postgres'
//
// Default 'sheets' → re-exporta tal cual google-sheets (cero cambios en prod).
// 'postgres' → usa el proyecto Supabase de mailing (getSupabase). El esquema lo
// crea supabase/schema-principal.sql (columnas text; id identity; función next_id).
//
// NOTA fechas/horas: en postgres las columnas son text y se guardan NORMALIZADAS a
// ISO/HH:MM por el import (scripts/importar-a-postgres). lib/dates ya maneja ISO y
// serial, así que la lectura solo convierte a string. Ver docs/migracion-postgres.md.
// ─────────────────────────────────────────────────────────────────────────────

const BACKEND = (process.env.DATA_BACKEND || 'sheets').toLowerCase()
const usePg = BACKEND === 'postgres'

/** true si el backend activo es Google Sheets (default). Útil para hacks que solo
 * aplican a Sheets (ej. el apóstrofo anti-fórmula de USER_ENTERED). */
export function isSheetsBackend(): boolean {
  return !usePg
}

// ── helpers postgres ─────────────────────────────────────────────────────────

/** Convierte cualquier valor a la representación string que espera la app. */
function toCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Fila de Postgres → Record<string,string> con el shape de getSheetData. */
function rowToStringRecord(row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(row)) out[k] = toCell(v)
  return out
}

/** Construye la fila a escribir, acotada a las columnas canónicas de la tabla. */
function rowForWrite(name: string, data: Record<string, unknown>, opts: { full: boolean }): Record<string, string> {
  const cols = SHEETS[name] ?? Object.keys(data)
  const out: Record<string, string> = {}
  for (const c of cols) {
    if (c === 'id') {
      if (data.id !== undefined && data.id !== null && String(data.id) !== '') out.id = String(data.id)
      continue
    }
    if (c in data) out[c] = toCell(data[c])
    else if (opts.full) out[c] = '' // updateRow de Sheets sobreescribe toda la fila
  }
  return out
}

async function pgSelectAll(name: string): Promise<Record<string, unknown>[]> {
  const sb = getSupabase()
  const PAGE = 1000
  const all: Record<string, unknown>[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(name).select('*').order('id', { ascending: true }).range(from, from + PAGE - 1)
    if (error) throw new Error(`[datastore] select ${name}: ${error.message}`)
    const chunk = (data ?? []) as Record<string, unknown>[]
    all.push(...chunk)
    if (chunk.length < PAGE) break
  }
  return all
}

async function pgIdByIndex(name: string, rowIndex: number): Promise<number | null> {
  const sb = getSupabase()
  // Resuelve el id en la posición rowIndex del mismo ORDER BY id que usa getSheetData.
  const { data, error } = await sb.from(name).select('id').order('id', { ascending: true }).range(rowIndex, rowIndex)
  if (error) throw new Error(`[datastore] idByIndex ${name}: ${error.message}`)
  const id = (data?.[0] as { id?: number } | undefined)?.id
  return id ?? null
}

// ── API pública (mismas firmas que google-sheets) ────────────────────────────

export function invalidateHeadersCache(sheetName?: string): void {
  if (!usePg) sheets.invalidateHeadersCache(sheetName)
}

export async function getSheetData(sheetName: string): Promise<Record<string, string>[]> {
  if (!usePg) return sheets.getSheetData(sheetName)
  const rows = await pgSelectAll(sheetName)
  return rows.map(rowToStringRecord)
}

export async function appendRow(sheetName: string, data: Record<string, unknown>): Promise<void> {
  if (!usePg) return sheets.appendRow(sheetName, data)
  const { error } = await getSupabase().from(sheetName).insert(rowForWrite(sheetName, data, { full: false }))
  if (error) throw new Error(`[datastore] insert ${sheetName}: ${error.message}`)
}

export async function appendRows(sheetName: string, rows: Record<string, unknown>[]): Promise<void> {
  if (!usePg) return sheets.appendRows(sheetName, rows)
  if (rows.length === 0) return
  const payload = rows.map(r => rowForWrite(sheetName, r, { full: false }))
  const { error } = await getSupabase().from(sheetName).insert(payload)
  if (error) throw new Error(`[datastore] insert(bulk) ${sheetName}: ${error.message}`)
}

export async function updateRow(sheetName: string, rowIndex: number, data: Record<string, unknown>): Promise<void> {
  if (!usePg) return sheets.updateRow(sheetName, rowIndex, data)
  const id = await pgIdByIndex(sheetName, rowIndex)
  if (id == null) throw new Error(`[datastore] updateRow ${sheetName}: no existe fila en índice ${rowIndex}`)
  const { error } = await getSupabase().from(sheetName).update(rowForWrite(sheetName, data, { full: true })).eq('id', id)
  if (error) throw new Error(`[datastore] update ${sheetName}: ${error.message}`)
}

/** Update por id (preferido sobre updateRow; sin TOCTOU). En sheets resuelve el índice. */
export async function updateById(sheetName: string, id: string | number, data: Record<string, unknown>): Promise<void> {
  if (!usePg) {
    const rows = await sheets.getSheetData(sheetName)
    const idx = rows.findIndex(r => String(r.id) === String(id))
    if (idx === -1) throw new Error(`[datastore] updateById ${sheetName}: id ${id} no encontrado`)
    return sheets.updateRow(sheetName, idx, data)
  }
  const { error } = await getSupabase().from(sheetName).update(rowForWrite(sheetName, data, { full: true })).eq('id', String(id))
  if (error) throw new Error(`[datastore] updateById ${sheetName}: ${error.message}`)
}

/**
 * Update condicional por id: aplica `changes` (PARCIAL — solo esas columnas) SOLO
 * si la fila con ese id cumple todos los pares de `expected` (igualdad). Devuelve
 * true si actualizó, false si la condición no se cumplió (otro proceso ganó la
 * carrera, o el estado cambió).
 *
 * En Postgres es ATÓMICO: `UPDATE … WHERE id=? AND col=? …` en una sola sentencia
 * → sirve para resolver races tipo "primer veterinario que acepta gana".
 * En Sheets es best-effort (re-lee y compara antes de escribir; la ventana TOCTOU
 * se reduce pero no desaparece — la API de Sheets no tiene transacciones).
 */
export async function updateByIdIf(
  sheetName: string,
  id: string | number,
  expected: Record<string, string>,
  changes: Record<string, unknown>,
): Promise<boolean> {
  if (!usePg) {
    const rows = await sheets.getSheetData(sheetName)
    const idx = rows.findIndex(r => String(r.id) === String(id))
    if (idx === -1) return false
    const row = rows[idx]
    for (const [k, v] of Object.entries(expected)) {
      if (String(row[k] ?? '') !== String(v)) return false
    }
    await sheets.updateRow(sheetName, idx, { ...row, ...changes })
    return true
  }
  let q = getSupabase().from(sheetName).update(rowForWrite(sheetName, changes, { full: false })).eq('id', String(id))
  for (const [k, v] of Object.entries(expected)) q = q.eq(k, v)
  const { data, error } = await q.select('id')
  if (error) throw new Error(`[datastore] updateByIdIf ${sheetName}: ${error.message}`)
  return (data?.length ?? 0) > 0
}

export async function findRows(sheetName: string, field: string, value: string): Promise<Record<string, string>[]> {
  if (!usePg) return sheets.findRows(sheetName, field, value)
  const rows = await getSheetData(sheetName)
  return rows.filter(r => r[field] === value)
}

export async function deleteRow(sheetName: string, rowIndex: number): Promise<void> {
  if (!usePg) return sheets.deleteRow(sheetName, rowIndex)
  const id = await pgIdByIndex(sheetName, rowIndex)
  if (id == null) throw new Error(`[datastore] deleteRow ${sheetName}: no existe fila en índice ${rowIndex}`)
  const { error } = await getSupabase().from(sheetName).delete().eq('id', id)
  if (error) throw new Error(`[datastore] delete ${sheetName}: ${error.message}`)
}

/** Delete por id (preferido sobre deleteRow; sin TOCTOU de índice). */
export async function deleteById(sheetName: string, id: string | number): Promise<void> {
  if (!usePg) {
    const rows = await sheets.getSheetData(sheetName)
    const idx = rows.findIndex(r => String(r.id) === String(id))
    if (idx === -1) throw new Error(`[datastore] deleteById ${sheetName}: id ${id} no encontrado`)
    return sheets.deleteRow(sheetName, idx)
  }
  const { error } = await getSupabase().from(sheetName).delete().eq('id', String(id))
  if (error) throw new Error(`[datastore] deleteById ${sheetName}: ${error.message}`)
}

export async function getNextId(sheetName: string): Promise<string> {
  if (!usePg) return sheets.getNextId(sheetName)
  const { data, error } = await getSupabase().rpc('next_id', { p_table: sheetName })
  if (error) throw new Error(`[datastore] next_id ${sheetName}: ${error.message}`)
  return String(data)
}

// ── Schema ops: en postgres las maneja el SQL/migraciones (no-op) ─────────────

export async function ensureSheet(sheetName: string): Promise<void> {
  if (!usePg) return sheets.ensureSheet(sheetName)
}

export async function ensureColumn(sheetName: string, columnName: string): Promise<void> {
  if (!usePg) return sheets.ensureColumn(sheetName, columnName)
}

export async function ensureColumns(sheetName: string, columnNames: string[]): Promise<void> {
  if (!usePg) return sheets.ensureColumns(sheetName, columnNames)
}

// Reordenar columnas / mover filas son operaciones específicas de la planilla
// (layout visual). No aplican a Postgres → en ese backend lanzan claro.
export async function reorderColumns(sheetName: string, desiredOrder: string[]) {
  if (!usePg) return sheets.reorderColumns(sheetName, desiredOrder)
  throw new Error('reorderColumns no aplica con DATA_BACKEND=postgres')
}

export async function moveRow(sheetName: string, rowIndex: number, direction: 'up' | 'down'): Promise<void> {
  if (!usePg) return sheets.moveRow(sheetName, rowIndex, direction)
  throw new Error('moveRow no aplica con DATA_BACKEND=postgres')
}
