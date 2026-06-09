import './_env-preload'
import { getSheetData } from '../lib/google-sheets'
import { getSupabase } from '../lib/supabase'
import { SHEETS } from '../lib/sheets-schema'
import { normalizarCelda } from '../lib/sheets-column-types'

/**
 * Verifica la migración: compara, por tabla, el conteo de filas Sheets vs Postgres
 * y hace una comparación celda por celda (normalizando el lado Sheets con
 * normalizarCelda, igual que el import). Reporta diferencias.
 *
 * Uso:  npx tsx scripts/verificar-migracion.ts [tabla...]
 */

const EXCLUIR = new Set(['mailing_logs'])
const MAX_DIFF_MOSTRAR = 8

async function leerSheet(name: string): Promise<Record<string, string>[]> {
  try { return await getSheetData(name) } catch { return [] }
}

async function pgSelectAll(name: string): Promise<Record<string, unknown>[]> {
  const sb = getSupabase()
  const PAGE = 1000
  const all: Record<string, unknown>[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(name).select('*').order('id', { ascending: true }).range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const chunk = (data ?? []) as Record<string, unknown>[]
    all.push(...chunk)
    if (chunk.length < PAGE) break
  }
  return all
}

function celdaPg(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return String(v)
}

async function verificarTabla(name: string, cols: string[]) {
  const sheetRows = await leerSheet(name)
  let pgRows: Record<string, unknown>[]
  try { pgRows = await pgSelectAll(name) } catch (e) {
    return { name, ok: false, msg: `Postgres: ${e instanceof Error ? e.message : String(e)}` }
  }

  const diffs: string[] = []
  const pgById = new Map(pgRows.map(r => [String(r.id), r]))

  for (const sRow of sheetRows) {
    const id = normalizarCelda('id', sRow.id)
    if (id === '') continue
    const pgRow = pgById.get(id)
    if (!pgRow) { diffs.push(`id ${id}: falta en Postgres`); continue }
    for (const col of cols) {
      if (col === 'id') continue
      const esperado = normalizarCelda(col, sRow[col])
      const real = celdaPg(pgRow[col])
      if (esperado !== real) diffs.push(`id ${id}.${col}: sheets="${esperado}" pg="${real}"`)
    }
  }

  const countOk = sheetRows.length === pgRows.length
  const ok = countOk && diffs.length === 0
  return { name, ok, sheet: sheetRows.length, pg: pgRows.length, countOk, diffs }
}

async function main() {
  const args = process.argv.slice(2)
  const tablas = (args.length > 0 ? args : Object.keys(SHEETS)).filter(t => !EXCLUIR.has(t) && SHEETS[t])

  console.log(`Verificando ${tablas.length} tabla(s)…\n`)
  let okAll = true
  for (const t of tablas) {
    const r = await verificarTabla(t, SHEETS[t])
    if ('msg' in r) { console.log(`  ✗ ${t}: ${r.msg}`); okAll = false; continue }
    const tag = r.ok ? '✓' : '✗'
    const cnt = r.countOk ? `${r.sheet}` : `sheets ${r.sheet} ≠ pg ${r.pg}`
    console.log(`  ${tag} ${t}: ${cnt}${r.diffs.length ? ` · ${r.diffs.length} diff` : ''}`)
    if (!r.ok) {
      okAll = false
      for (const d of r.diffs.slice(0, MAX_DIFF_MOSTRAR)) console.log(`      - ${d}`)
      if (r.diffs.length > MAX_DIFF_MOSTRAR) console.log(`      … +${r.diffs.length - MAX_DIFF_MOSTRAR} más`)
    }
  }
  console.log(`\n${okAll ? '✅ Todo coincide.' : '⚠️ Hay diferencias (ver arriba).'}`)
  if (!okAll) process.exit(1)
}

main().catch(e => { console.error('❌ Error verificando:', e); process.exit(1) })
