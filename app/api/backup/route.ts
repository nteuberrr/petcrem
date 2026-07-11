import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { SupabaseClient } from '@supabase/supabase-js'
import { getSupabase, getMensajesSupabase, isMensajesSupabaseConfigured } from '@/lib/supabase'
import { SHEETS } from '@/lib/sheets-schema'
import { uploadBackupToR2 } from '@/lib/cloudflare-r2'
import { pingHealthcheck } from '@/lib/healthcheck'

// Backup automático de Postgres → R2 (un JSON con todas las tablas).
// Lo llama Vercel Cron (ver vercel.json) una vez al día. Ruta PÚBLICA en proxy,
// autenticada por el header Authorization: Bearer <CRON_SECRET> que envía Vercel.
// Fail-closed: sin CRON_SECRET el endpoint responde 503 y no hace backup.
// Manual: GET con el mismo header. Sube a R2 bajo backups/petcrem-<timestamp>.json.
//
// Respalda DOS proyectos Supabase separados (ver CLAUDE.md): el principal (todas
// las tablas de SHEETS) y el de Mensajes/WhatsApp (otro proyecto, otras
// credenciales — antes NO se respaldaba). Son dos uploads independientes: si el
// de Mensajes falla, no aborta el backup principal (ya subido) ni viceversa.

export const dynamic = 'force-dynamic'
export const maxDuration = 90

const TABLAS = Object.keys(SHEETS) // incluye mailing_logs
const TABLAS_MENSAJES = ['mensajes_contactos', 'mensajes_conversaciones', 'mensajes_mensajes', 'agente_config']

async function selectAllFrom(sb: SupabaseClient, name: string): Promise<Record<string, unknown>[]> {
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

async function selectAll(name: string): Promise<Record<string, unknown>[]> {
  return selectAllFrom(getSupabase(), name)
}

/** Respaldo del proyecto Supabase de Mensajes (WhatsApp/IG) — best-effort, en su
 *  propio try/catch para no tumbar el backup principal si este falla. */
async function respaldarMensajes(stamp: string): Promise<{ ok: boolean; key?: string; filas?: number; error?: string }> {
  if (!isMensajesSupabaseConfigured()) return { ok: false, error: 'Supabase de Mensajes no configurado' }
  try {
    const sb = getMensajesSupabase()
    const dump: Record<string, Record<string, unknown>[]> = {}
    const conteos: Record<string, number> = {}
    let total = 0
    for (const t of TABLAS_MENSAJES) {
      try {
        const rows = await selectAllFrom(sb, t)
        dump[t] = rows
        conteos[t] = rows.length
        total += rows.length
      } catch (e) {
        conteos[t] = -1
        console.warn(`[backup:mensajes] ${t}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    const payload = Buffer.from(JSON.stringify({ fecha: new Date().toISOString(), conteos, data: dump }))
    const key = `backups/mensajes-${stamp}-${crypto.randomBytes(16).toString('hex')}.json`
    const up = await uploadBackupToR2(payload, key, 'application/json')
    console.log(`[backup:mensajes] OK → ${up.bucket}/${up.key} · ${total} filas`)
    return { ok: true, key: up.key, filas: total }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[backup:mensajes] error:', msg)
    return { ok: false, error: msg }
  }
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
    // Sufijo aleatorio de 128 bits: aunque el bucket de respaldos es privado (sin
    // dominio público), es una segunda capa — la key nunca se expone en la respuesta.
    const key = `backups/petcrem-${stamp}-${crypto.randomBytes(16).toString('hex')}.json`
    const up = await uploadBackupToR2(payload, key, 'application/json')

    console.log(`[backup] OK → ${up.bucket}/${up.key} · ${total} filas`)

    // Segundo proyecto Supabase (Mensajes/WhatsApp) — independiente del anterior.
    const mensajes = await respaldarMensajes(stamp)

    await pingHealthcheck('HEALTHCHECK_URL_BACKUP')

    // Sin URL pública en la respuesta: el backup completo no debe quedar linkeable
    return NextResponse.json({
      ok: true, key: up.key, tablas: Object.keys(conteos).length, filas: total, bytes: payload.length,
      mensajes,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[backup] error:', msg)
    await pingHealthcheck('HEALTHCHECK_URL_BACKUP', { fail: true })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
