import { NextResponse } from 'next/server'
import { ensureSheet, ensureColumns } from '@/lib/datastore'
import { SHEETS } from '@/lib/sheets-schema'

// El mapa canónico de hojas/columnas vive en lib/sheets-schema (lo comparten
// este endpoint y scripts/generar-schema-sql). Idempotente: si la hoja existe,
// solo agrega columnas faltantes.

export async function POST() {
  const results: Array<{ hoja: string; ok: boolean; error?: string }> = []
  for (const [nombre, columnas] of Object.entries(SHEETS)) {
    try {
      await ensureSheet(nombre)
      await ensureColumns(nombre, columnas)
      results.push({ hoja: nombre, ok: true })
    } catch (e) {
      results.push({ hoja: nombre, ok: false, error: String(e) })
    }
  }
  const okCount = results.filter(r => r.ok).length
  return NextResponse.json({ ok: okCount === results.length, total: results.length, ok_count: okCount, results })
}

export async function GET() {
  return POST()
}
