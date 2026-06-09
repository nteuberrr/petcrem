import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { SHEETS } from '@/lib/sheets-schema'
import { uploadToR2 } from '@/lib/cloudflare-r2'

// Backup automático de Postgres → R2 (un JSON con todas las tablas).
// Lo llama Vercel Cron (ver vercel.json) una vez al día. Ruta PÚBLICA en proxy,
// autenticada por el header Authorization: Bearer <CRON_SECRET> que envía Vercel.
// Manual: GET con el mismo header. Sube a R2 bajo backups/petcrem-<timestamp>.json.

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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

export async function GET(req: NextRequest) {
  // Auth: si hay CRON_SECRET, exigir el Bearer (Vercel Cron lo envía). Sin secret, avisamos.
  const secret = process.env.CRON_SECRET
  if (secret) {
    if (req.headers.get('authorization') !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }
  } else {
    console.warn('[backup] CRON_SECRET no configurado — el endpoint queda abierto. Configúralo en Vercel.')
  }

  try {
    const dump: Record<string, Record<string, unknown>[]> = {}
    const conteos: Record<string, number> = {}
    let total = 0
    for (const t of TABLAS) {
      try {
        const rows = await selectAll(t)
        dump[t] = rows
        conteos[t] = rows.length
        total += rows.length
      } catch (e) {
        conteos[t] = -1
        console.warn(`[backup] ${t}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const payload = JSON.stringify({ fecha: new Date().toISOString(), conteos, data: dump })
    const key = `backups/petcrem-${stamp}.json`
    const up = await uploadToR2(Buffer.from(payload), key, 'application/json')

    console.log(`[backup] OK → ${up.key} · ${total} filas`)
    return NextResponse.json({ ok: true, key: up.key, url: up.url, tablas: Object.keys(conteos).length, filas: total })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[backup] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
