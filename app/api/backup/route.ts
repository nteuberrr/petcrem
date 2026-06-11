import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { getSupabase } from '@/lib/supabase'
import { SHEETS } from '@/lib/sheets-schema'
import { uploadToR2 } from '@/lib/cloudflare-r2'

// Backup automático de Postgres → R2 (un JSON con todas las tablas).
// Lo llama Vercel Cron (ver vercel.json) una vez al día. Ruta PÚBLICA en proxy,
// autenticada por el header Authorization: Bearer <CRON_SECRET> que envía Vercel.
// Fail-closed: sin CRON_SECRET el endpoint responde 503 y no hace backup.
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
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET no configurado — backup deshabilitado' }, { status: 503 })
  }
  // sha256 de ambos lados para comparar timing-safe sin filtrar longitudes
  const auth = req.headers.get('authorization') || ''
  const a = crypto.createHash('sha256').update(auth).digest()
  const b = crypto.createHash('sha256').update(`Bearer ${secret}`).digest()
  if (!crypto.timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const dump: Record<string, Record<string, unknown>[]> = {}
    const conteos: Record<string, number> = {}
    let total = 0
    for (const t of TABLAS) {
      try {
        const rows = await selectAll(t)
        // El dump no incluye contraseñas (queda en R2 como JSON plano). Máscara ''
        // (no un sentinel): si alguna vez se restaura este dump, '' no puede usarse
        // para loguear (authorize exige password truthy) — un sentinel fijo sí podría.
        dump[t] = t === 'usuarios'
          ? rows.map(r => ({ ...r, password: '' }))
          : rows
        conteos[t] = rows.length
        total += rows.length
      } catch (e) {
        conteos[t] = -1
        console.warn(`[backup] ${t}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const payload = Buffer.from(JSON.stringify({ fecha: new Date().toISOString(), conteos, data: dump }))
    // El bucket R2 tiene dominio público (sirve assets/PDFs) pero NO permite listar:
    // un sufijo aleatorio de 128 bits hace la key inadivinable (equivale a un token).
    // Sin él, el timestamp del cron diario sería fuerza-bruteable.
    const key = `backups/petcrem-${stamp}-${crypto.randomBytes(16).toString('hex')}.json`
    const up = await uploadToR2(payload, key, 'application/json')

    console.log(`[backup] OK → ${up.key} · ${total} filas`)
    // Sin URL pública en la respuesta: el backup completo no debe quedar linkeable
    return NextResponse.json({ ok: true, key: up.key, tablas: Object.keys(conteos).length, filas: total, bytes: payload.length })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[backup] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
