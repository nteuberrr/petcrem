import './_env-preload'
import { getSupabase } from '../lib/supabase'
import { SHEETS } from '../lib/sheets-schema'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Respaldo COMPLETO de Postgres (proyecto Alma Animal) a `respaldo postgres/<ts>/`.
 * Un JSON por tabla + _TODO.json combinado + _manifest.json. Análogo a respaldo-sheets.
 *
 * Uso:  npx tsx scripts/respaldo-postgres.ts
 * (lee SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY de .env.local)
 *
 * Para el backup AUTOMÁTICO diario, ver app/api/backup (Vercel Cron → R2).
 */

const TABLAS = Object.keys(SHEETS) // incluye mailing_logs

async function selectAll(name: string): Promise<Record<string, unknown>[]> {
  const sb = getSupabase()
  const PAGE = 1000
  const all: Record<string, unknown>[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(name).select('*').order('id', { ascending: true }).range(from, from + PAGE - 1)
    if (error) throw new Error(`${name}: ${error.message}`)
    const chunk = (data ?? []) as Record<string, unknown>[]
    all.push(...chunk)
    if (chunk.length < PAGE) break
  }
  return all
}

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = join(process.cwd(), 'respaldo postgres', stamp)
  mkdirSync(dir, { recursive: true })

  const todo: Record<string, Record<string, unknown>[]> = {}
  const manifest: { fecha: string; tablas: Record<string, number> } = { fecha: new Date().toISOString(), tablas: {} }
  let total = 0

  for (const t of TABLAS) {
    try {
      const rows = await selectAll(t)
      writeFileSync(join(dir, `${t}.json`), JSON.stringify(rows, null, 2), 'utf8')
      todo[t] = rows
      manifest.tablas[t] = rows.length
      total += rows.length
      console.log(`  ✓ ${t}: ${rows.length} filas`)
    } catch (e) {
      console.warn(`  ✗ ${t}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  writeFileSync(join(dir, '_TODO.json'), JSON.stringify(todo, null, 2), 'utf8')
  writeFileSync(join(dir, '_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  console.log(`\n✅ Respaldo Postgres: ${Object.keys(manifest.tablas).length} tablas · ${total} filas`)
  console.log(`   Carpeta: respaldo postgres/${stamp}`)
}

main().catch(e => { console.error('❌ Error en el respaldo:', e); process.exit(1) })
