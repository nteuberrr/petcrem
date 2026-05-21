import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, updateRow } from '@/lib/google-sheets'
import { getFromR2 } from '@/lib/cloudflare-r2'
import { sendBatch, isResendConfigured } from '@/lib/resend-mailer'
import { renderForVet } from '@/lib/mailing-render'
import { getSupabase, type MailingLogInsert } from '@/lib/supabase'
import { todayISO } from '@/lib/dates'

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

    const supabase = getSupabase()
    let enviados = 0
    let fallidos = 0
    let cancelado = false
    const CHUNK = 100
    const ahora = new Date().toISOString()

    for (let start = 0; start < destinatarios.length; start += CHUNK) {
      // Antes de cada chunk, releer la campaña y chequear si fue cancelada
      if (start > 0) {
        const recheck = await getSheetData('mailing_campanas')
        const cur = recheck.find(r => r.id === id)
        if (cur?.estado === 'cancelando') {
          cancelado = true
          break
        }
      }
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
        // Para el tracking propio: inyectamos el pixel y reescribimos los links
        tracking: { campana_id: String(id), vet_id: String(v.id) },
      }))

      const results = await sendBatch(emails)

      // Persistir logs en Supabase (1 insert batch por chunk)
      const logsBatch: MailingLogInsert[] = []
      for (let i = 0; i < chunk.length; i++) {
        const v = chunk[i]
        const r = results[i]
        const estado = r.ok ? 'sent' : 'failed'
        if (r.ok) enviados++; else fallidos++
        logsBatch.push({
          campana_id: id,
          vet_id: v.id,
          vet_email: v.email,
          vet_nombre: v.nombre || null,
          resend_message_id: r.message_id || null,
          estado,
          fecha_envio: r.ok ? ahora : null,
          fecha_entrega: null, fecha_apertura: null, fecha_click: null, fecha_rebote: null,
          motivo_rebote: null, url_clickeada: null,
          error_msg: r.error || null,
        })
      }
      const { error: insertErr } = await supabase.from('mailing_logs').insert(logsBatch)
      if (insertErr) console.error('[mailing/enviar] insert logs error:', insertErr.message)
    }

    // Actualizar campana final
    const campanas2 = await getSheetData('mailing_campanas')
    const idx2 = campanas2.findIndex(r => r.id === id)
    if (idx2 >= 0) {
      const estadoFinal = cancelado
        ? 'cancelado'
        : (fallidos === destinatarios.length ? 'fallido' : 'enviado')
      await updateRow('mailing_campanas', idx2, {
        ...campanas2[idx2],
        estado: estadoFinal,
        enviados: String(enviados),
        fallidos: String(fallidos),
      })
    }

    return NextResponse.json({
      ok: true,
      cancelado,
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
