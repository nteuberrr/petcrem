import './_env-preload'
import { getSheetData } from '../lib/google-sheets'
import { getSupabase } from '../lib/supabase'
import { SHEETS } from '../lib/sheets-schema'
import { normalizarCelda } from '../lib/sheets-column-types'

/**
 * Import inicial Sheets → Postgres (Supabase mailing project).
 * - Lee cada tabla del mapa canónico, normaliza fechas/horas/booleanos a ISO/HH:MM
 *   (normalizarCelda) y preserva los ids actuales.
 * - Idempotente por tabla: borra todo y reinserta. Al final ajusta el sequence (reset_id_seq).
 *
 * Requisitos: haber corrido supabase/schema-principal.sql en el proyecto y tener
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY + credenciales de Google en .env.local.
 *
 * Uso:  npx tsx scripts/importar-a-postgres.ts            (todas las tablas)
 *       npx tsx scripts/importar-a-postgres.ts clientes ciclos   (solo esas)
 */

const EXCLUIR = new Set(['mailing_logs']) // ya vive en el proyecto Supabase de mailing
const CHUNK = 500

async function leerSheet(name: string): Promise<Record<string, string>[]> {
  try {
    return await getSheetData(name)
  } catch {
    // La hoja puede no existir aún (ej. config_eutanasia/solicitudes_retiro) → 0 filas.
    return []
  }
}

async function importarTabla(name: string, cols: string[]): Promise<{ name: string; filas: number; error?: string; sinId?: number }> {
  const sb = getSupabase()
  const rows = await leerSheet(name)

  // Construir registros normalizados.
  const registros: Record<string, unknown>[] = []
  let sinId = 0
  for (const row of rows) {
    const idVal = normalizarCelda('id', row.id)
    if (idVal === '') { sinId++; continue }
    const rec: Record<string, unknown> = { id: Number(idVal) }
    for (const col of cols) {
      if (col === 'id') continue
      rec[col] = normalizarCelda(col, row[col])
    }
    registros.push(rec)
  }

  // Borrar todo lo existente (delete all: id >= 0).
  const del = await sb.from(name).delete().gte('id', 0)
  if (del.error) return { name, filas: 0, error: `delete: ${del.error.message}` }

  // Insertar en lotes.
  for (let i = 0; i < registros.length; i += CHUNK) {
    const lote = registros.slice(i, i + CHUNK)
    const ins = await sb.from(name).insert(lote)
    if (ins.error) return { name, filas: 0, error: `insert: ${ins.error.message}` }
  }

  // Reset del sequence de id al max(id).
  const rst = await sb.rpc('reset_id_seq', { p_table: name })
  if (rst.error) return { name, filas: registros.length, error: `reset_id_seq: ${rst.error.message}` }

  return { name, filas: registros.length, sinId }
}

async function main() {
  const args = process.argv.slice(2)
  const tablas = (args.length > 0 ? args : Object.keys(SHEETS)).filter(t => !EXCLUIR.has(t) && SHEETS[t])

  console.log(`Importando ${tablas.length} tabla(s) a Postgres…\n`)
  const resultados: Array<{ name: string; filas: number; error?: string; sinId?: number }> = []
  for (const t of tablas) {
    const r = await importarTabla(t, SHEETS[t])
    resultados.push(r)
    const nota = r.sinId ? ` (omitidas ${r.sinId} sin id)` : ''
    console.log(r.error ? `  ✗ ${t}: ERROR — ${r.error}` : `  ✓ ${t}: ${r.filas} filas${nota}`)
  }

  const oks = resultados.filter(r => !r.error)
  const total = oks.reduce((s, r) => s + r.filas, 0)
  const fallos = resultados.filter(r => r.error)
  console.log(`\n${fallos.length === 0 ? '✅' : '⚠️'} Import: ${oks.length}/${resultados.length} tablas OK · ${total} filas`)
  if (fallos.length) {
    console.log('Fallaron:', fallos.map(f => f.name).join(', '))
    process.exit(1)
  }
}

main().catch(e => { console.error('❌ Error en el import:', e); process.exit(1) })
