import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, appendRow, getNextId, ensureSheet, ensureColumns } from '@/lib/datastore'
import { uploadToR2 } from '@/lib/cloudflare-r2'
import { todayISO } from '@/lib/dates'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase'
import { esAdmin } from '@/lib/roles'

const SHEET = 'mailing_campanas'
const COLS = [
  'id', 'asunto', 'html_key', 'html_url', 'preview_text', 'reply_to',
  'fecha_envio', 'total_destinatarios',
  'enviados', 'entregados', 'aperturas', 'clicks', 'rebotes', 'spam', 'fallidos',
  'estado', 'filtros_json',
  'creado_por', 'fecha_creacion',
]

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!esAdmin((session?.user as { role?: string })?.role)) {
    return { denied: NextResponse.json({ error: 'Solo admin' }, { status: 403 }), session: null }
  }
  return { denied: null, session }
}

export async function GET() {
  const { denied } = await requireAdmin()
  if (denied) return denied
  await ensureSheet(SHEET)
  await ensureColumns(SHEET, COLS)
  const rows = await getSheetData(SHEET)
  rows.sort((a, b) => (b.fecha_creacion || '').localeCompare(a.fecha_creacion || ''))

  // Pisar contadores con los valores REALES desde Supabase (mailing_logs).
  // Antes los actualizábamos en cada webhook event, pero eso era 1 read+write
  // contra Sheets por evento y reventaba la cuota con campañas grandes. Ahora
  // los recalculamos on-demand: una sola query agregada cuando se carga el
  // listado.
  if (isSupabaseConfigured() && rows.length > 0) {
    try {
      const supabase = getSupabase()
      const campanaIds = rows.map(r => r.id).filter(Boolean)
      const { data: logs, error } = await supabase
        .from('mailing_logs')
        .select('campana_id, estado, fecha_envio, fecha_entrega, fecha_apertura, fecha_click, fecha_rebote')
        .in('campana_id', campanaIds)
      if (!error && logs) {
        // Acumulador por campana_id
        const acc = new Map<string, { enviados: number; entregados: number; aperturas: number; clicks: number; rebotes: number; spam: number; fallidos: number }>()
        for (const id of campanaIds) {
          acc.set(id, { enviados: 0, entregados: 0, aperturas: 0, clicks: 0, rebotes: 0, spam: 0, fallidos: 0 })
        }
        for (const l of logs) {
          const a = acc.get(l.campana_id)
          if (!a) continue
          if (l.fecha_envio) a.enviados += 1
          if (l.fecha_entrega) a.entregados += 1
          if (l.fecha_apertura) a.aperturas += 1
          if (l.fecha_click) a.clicks += 1
          if (l.fecha_rebote) a.rebotes += 1
          if (l.estado === 'complained') a.spam += 1
          if (l.estado === 'failed') a.fallidos += 1
        }
        for (const r of rows) {
          const a = acc.get(r.id)
          if (!a) continue
          // Solo pisar si Supabase tiene >= que la planilla. Si la planilla
          // tiene un número manual / histórico mayor, lo respetamos.
          const enviadosSheet = parseInt(r.enviados || '0', 10) || 0
          r.enviados = String(Math.max(a.enviados, enviadosSheet))
          r.entregados = String(a.entregados)
          r.aperturas = String(a.aperturas)
          r.clicks = String(a.clicks)
          r.rebotes = String(a.rebotes)
          r.spam = String(a.spam)
          r.fallidos = String(Math.max(a.fallidos, parseInt(r.fallidos || '0', 10) || 0))
        }
      }
    } catch (err) {
      console.warn('[mailing/campanas] agregación Supabase falló (sigo con valores de planilla):', err)
    }
  }

  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const { denied, session } = await requireAdmin()
  if (denied) return denied

  try {
    const body = (await req.json()) as {
      asunto?: string
      html?: string
      preview_text?: string
      reply_to?: string
      filtros?: Record<string, unknown>
    }
    if (!body.asunto || !body.asunto.trim()) {
      return NextResponse.json({ error: 'asunto es requerido' }, { status: 400 })
    }
    if (!body.html || !body.html.trim()) {
      return NextResponse.json({ error: 'html es requerido' }, { status: 400 })
    }

    await ensureSheet(SHEET)
    await ensureColumns(SHEET, COLS)

    const id = await getNextId(SHEET)
    const htmlKey = `mailing/campanas/${id}.html`
    const upload = await uploadToR2(Buffer.from(body.html, 'utf8'), htmlKey, 'text/html; charset=utf-8')

    const creadoPor = session?.user?.name || session?.user?.email || ''
    const data: Record<string, string> = {
      id,
      asunto: body.asunto.trim(),
      html_key: upload.key,
      html_url: upload.url,
      preview_text: (body.preview_text ?? '').trim(),
      reply_to: (body.reply_to ?? '').trim(),
      fecha_envio: '',
      total_destinatarios: '0',
      enviados: '0', entregados: '0', aperturas: '0', clicks: '0',
      rebotes: '0', spam: '0', fallidos: '0',
      estado: 'borrador',
      filtros_json: body.filtros ? JSON.stringify(body.filtros) : '',
      creado_por: creadoPor,
      fecha_creacion: todayISO(),
    }
    await appendRow(SHEET, data)
    return NextResponse.json({ ok: true, id, data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
