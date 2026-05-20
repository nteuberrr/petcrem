import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, appendRow, getNextId, ensureSheet, ensureColumns } from '@/lib/google-sheets'
import { uploadToR2 } from '@/lib/cloudflare-r2'
import { todayISO } from '@/lib/dates'

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
  if ((session?.user as { role?: string })?.role !== 'admin') {
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
