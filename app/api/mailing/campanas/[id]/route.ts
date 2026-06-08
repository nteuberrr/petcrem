import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, updateRow, deleteRow, ensureSheet, ensureColumns } from '@/lib/google-sheets'
import { uploadToR2, deleteFromR2 } from '@/lib/cloudflare-r2'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase'
import { esAdmin } from '@/lib/roles'

const SHEET = 'mailing_campanas'
const COLS = [
  'id', 'asunto', 'html_key', 'html_url', 'preview_text', 'reply_to',
  'fecha_envio', 'hora_envio', 'total_destinatarios',
  'enviados', 'entregados', 'aperturas', 'clicks', 'rebotes', 'spam', 'fallidos',
  'estado', 'filtros_json', 'attachments_json',
  'creado_por', 'fecha_creacion',
]

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!esAdmin((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  return null
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied
  const { id } = await params
  await ensureSheet(SHEET)
  await ensureColumns(SHEET, COLS)
  const rows = await getSheetData(SHEET)
  const row = rows.find(r => r.id === id)
  if (!row) return NextResponse.json({ error: 'No encontrada' }, { status: 404 })

  // Logs de esta campaña vienen de Supabase
  let logsCampana: Record<string, unknown>[] = []
  if (isSupabaseConfigured()) {
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('mailing_logs')
      .select('*')
      .eq('campana_id', id)
      .order('id', { ascending: true })
    if (error) console.error('[campanas/get] supabase error:', error.message)
    else logsCampana = data || []
  }
  return NextResponse.json({ ...row, logs: logsCampana })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { id } = await params
    const body = (await req.json()) as {
      asunto?: string
      html?: string
      preview_text?: string
      reply_to?: string
      filtros?: Record<string, unknown>
    }
    const rows = await getSheetData(SHEET)
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrada' }, { status: 404 })
    const existing = rows[idx]
    if (existing.estado !== 'borrador') {
      return NextResponse.json({ error: 'Solo se pueden editar campañas en borrador' }, { status: 400 })
    }

    let html_key = existing.html_key
    let html_url = existing.html_url
    if (body.html != null) {
      const newKey = existing.html_key || `mailing/campanas/${id}.html`
      const up = await uploadToR2(Buffer.from(body.html, 'utf8'), newKey, 'text/html; charset=utf-8')
      html_key = up.key
      html_url = up.url
    }

    const updated = {
      ...existing,
      asunto: body.asunto != null ? body.asunto.trim() : existing.asunto,
      preview_text: body.preview_text != null ? body.preview_text.trim() : existing.preview_text,
      reply_to: body.reply_to != null ? body.reply_to.trim() : existing.reply_to,
      filtros_json: body.filtros != null ? JSON.stringify(body.filtros) : existing.filtros_json,
      html_key, html_url,
    }
    await updateRow(SHEET, idx, updated)
    return NextResponse.json({ ok: true, data: updated })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { id } = await params
    const rows = await getSheetData(SHEET)
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrada' }, { status: 404 })
    const row = rows[idx]
    if (row.estado === 'enviando') {
      return NextResponse.json({ error: 'No se puede borrar una campaña que se está enviando' }, { status: 400 })
    }
    if (row.html_key) await deleteFromR2(row.html_key)
    await deleteRow(SHEET, idx)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
