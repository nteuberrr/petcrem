import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, updateRow, appendRows, ensureSheet, ensureColumns } from '@/lib/google-sheets'
import { getFromR2 } from '@/lib/cloudflare-r2'
import { sendBatch, isResendConfigured } from '@/lib/resend-mailer'
import { renderForVet } from '@/lib/mailing-render'
import { todayISO } from '@/lib/dates'

const LOGS_COLS = [
  'id', 'campana_id', 'vet_email', 'vet_nombre', 'resend_message_id',
  'estado', 'fecha_envio', 'fecha_entrega', 'fecha_apertura', 'fecha_click', 'fecha_rebote',
  'motivo_rebote', 'url_clickeada', 'error_msg', 'fecha_creacion',
]

interface Filtros {
  categoria?: string
  comunas?: string[]
  ids_explicitos?: string[]
}

function filtrarVets(vets: Record<string, string>[], filtros: Filtros): Record<string, string>[] {
  return vets.filter(v => {
    if (v.suscrito !== 'TRUE') return false
    if (!v.email || !v.email.trim()) return false
    if (filtros.ids_explicitos && filtros.ids_explicitos.length > 0) {
      return filtros.ids_explicitos.includes(v.id)
    }
    if (filtros.categoria && filtros.categoria !== 'todos' && v.categoria !== filtros.categoria) return false
    if (filtros.comunas && filtros.comunas.length > 0 && !filtros.comunas.includes(v.comuna)) return false
    return true
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if ((session?.user as { role?: string })?.role !== 'admin') {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  if (!isResendConfigured()) {
    return NextResponse.json({ error: 'RESEND_API_KEY no configurada' }, { status: 500 })
  }

  try {
    const { id } = await params
    await ensureSheet('mailing_logs')
    await ensureColumns('mailing_logs', LOGS_COLS)

    const campanas = await getSheetData('mailing_campanas')
    const idx = campanas.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })
    const campana = campanas[idx]
    if (campana.estado !== 'borrador') {
      return NextResponse.json({ error: `La campaña ya está en estado "${campana.estado}"` }, { status: 400 })
    }
    if (!campana.html_key) return NextResponse.json({ error: 'Campaña sin HTML' }, { status: 400 })

    const buf = await getFromR2(campana.html_key)
    if (!buf) return NextResponse.json({ error: 'HTML no encontrado en R2' }, { status: 404 })
    const htmlTemplate = buf.toString('utf8')

    const filtros: Filtros = campana.filtros_json ? JSON.parse(campana.filtros_json) : {}
    const vets = await getSheetData('mailing_veterinarios')
    const destinatarios = filtrarVets(vets, filtros)
    if (destinatarios.length === 0) {
      return NextResponse.json({ error: 'No hay destinatarios suscritos que cumplan los filtros' }, { status: 400 })
    }

    // Marcar como enviando + total_destinatarios
    await updateRow('mailing_campanas', idx, {
      ...campana,
      estado: 'enviando',
      total_destinatarios: String(destinatarios.length),
      fecha_envio: todayISO(),
    })

    // Pre-reservar IDs para los logs (1 read en vez de N)
    const logsExistentes = await getSheetData('mailing_logs')
    let nextLogId = Math.max(0, ...logsExistentes.map(r => parseInt(r.id || '0', 10)).filter(n => !isNaN(n))) + 1

    let enviados = 0
    let fallidos = 0
    const CHUNK = 100  // Resend batch limit
    const ahora = new Date().toISOString()

    for (let start = 0; start < destinatarios.length; start += CHUNK) {
      const chunk = destinatarios.slice(start, start + CHUNK)
      const emails = chunk.map(v => ({
        to: v.email,
        subject: campana.asunto,
        html: renderForVet(htmlTemplate, {
          nombre: v.nombre, email: v.email, veterinaria: v.veterinaria,
          comuna: v.comuna, telefono: v.telefono, categoria: v.categoria,
        }),
        reply_to: campana.reply_to || undefined,
        preview_text: campana.preview_text || undefined,
        tags: [
          { name: 'campana_id', value: String(id) },
          { name: 'vet_id', value: String(v.id) },
        ],
      }))

      const results = await sendBatch(emails)

      // Acumular logs en memoria y escribirlos en UNA sola llamada por chunk
      // (Google Sheets API limita a 60 escrituras/min/user — sin batch, 140
      // emails harían 140 writes y excedería la cuota).
      const logsBatch: Record<string, unknown>[] = []
      for (let i = 0; i < chunk.length; i++) {
        const v = chunk[i]
        const r = results[i]
        const logId = String(nextLogId++)
        const estado = r.ok ? 'sent' : 'failed'
        if (r.ok) enviados++; else fallidos++
        logsBatch.push({
          id: logId,
          campana_id: id,
          vet_email: v.email,
          vet_nombre: v.nombre,
          resend_message_id: r.message_id || '',
          estado,
          fecha_envio: r.ok ? ahora : '',
          fecha_entrega: '', fecha_apertura: '', fecha_click: '', fecha_rebote: '',
          motivo_rebote: '', url_clickeada: '',
          error_msg: r.error || '',
          fecha_creacion: ahora,
        })
      }
      await appendRows('mailing_logs', logsBatch)
    }

    // Actualizar campana final (releer porque updateRow puede haber cambiado)
    const campanas2 = await getSheetData('mailing_campanas')
    const idx2 = campanas2.findIndex(r => r.id === id)
    if (idx2 >= 0) {
      await updateRow('mailing_campanas', idx2, {
        ...campanas2[idx2],
        estado: fallidos === destinatarios.length ? 'fallido' : 'enviado',
        enviados: String(enviados),
        fallidos: String(fallidos),
      })
    }

    return NextResponse.json({
      ok: true,
      total_destinatarios: destinatarios.length,
      enviados,
      fallidos,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[mailing/enviar] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
