import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, updateRow } from '@/lib/google-sheets'
import { getFromR2 } from '@/lib/cloudflare-r2'
import { sendBatch, isResendConfigured } from '@/lib/resend-mailer'
import { renderForVet } from '@/lib/mailing-render'
import { getSupabase, isSupabaseConfigured, type MailingLogInsert } from '@/lib/supabase'

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

/**
 * POST /api/mailing/campanas/[id]/reanudar
 *
 * Reanuda una campaña que quedó incompleta (estado 'enviando' por cuota cortada,
 * o 'fallido'). Calcula a quiénes ya se les envió (consultando mailing_logs por
 * vet_id) y manda SOLO a los que faltan.
 *
 * Idempotente: si la corres dos veces seguidas, la segunda no manda nada porque
 * todos los originales ya tienen log.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if ((session?.user as { role?: string })?.role !== 'admin') {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  if (!isResendConfigured()) {
    return NextResponse.json({ error: 'RESEND_API_KEY no configurada' }, { status: 500 })
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase no configurado' }, { status: 500 })
  }

  const baseUrl = (process.env.PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '').replace(/\/+$/, '')
  if (!baseUrl || /localhost|127\.0\.0\.1/i.test(baseUrl)) {
    return NextResponse.json(
      { error: `URL pública inválida: "${baseUrl || '(vacía)'}". Configurá PUBLIC_APP_URL en Vercel.` },
      { status: 500 },
    )
  }

  void req
  try {
    const { id } = await params

    const campanas = await getSheetData('mailing_campanas')
    const idx = campanas.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })
    const campana = campanas[idx]
    const estadosReanudables = ['enviando', 'enviado', 'fallido', 'cancelado']
    if (!estadosReanudables.includes(campana.estado)) {
      return NextResponse.json({
        error: `La campaña está en estado "${campana.estado}", no se puede reanudar. Solo se reanudan campañas en ${estadosReanudables.map(s => `'${s}'`).join(', ')}.`,
      }, { status: 400 })
    }
    if (!campana.html_key) return NextResponse.json({ error: 'Campaña sin HTML' }, { status: 400 })

    const buf = await getFromR2(campana.html_key)
    if (!buf) return NextResponse.json({ error: 'HTML no encontrado en R2' }, { status: 404 })
    const htmlTemplate = buf.toString('utf8')

    const filtros: Filtros = campana.filtros_json ? JSON.parse(campana.filtros_json) : {}
    const attachmentsRaw = campana.attachments_json ? JSON.parse(campana.attachments_json) : []
    const adjuntos = Array.isArray(attachmentsRaw)
      ? attachmentsRaw.map((a: { filename: string; url: string; content_type: string }) => ({
          filename: a.filename,
          path: a.url,
          content_type: a.content_type,
        }))
      : []
    const vets = await getSheetData('mailing_veterinarios')
    const destinatarios = filtrarVets(vets, filtros)

    // Calcular a quiénes ya se les envió OK (vía mailing_logs en Supabase).
    // Importante: los logs con estado='failed' NO cuentan como enviados —
    // esos fueron errores transitorios que vale la pena reintentar.
    const supabase = getSupabase()
    const { data: logs, error: logsErr } = await supabase
      .from('mailing_logs')
      .select('id, vet_id, vet_email, estado')
      .eq('campana_id', id)
    if (logsErr) {
      console.error('[reanudar] error leyendo logs:', logsErr.message)
      return NextResponse.json({ error: `Error leyendo logs: ${logsErr.message}` }, { status: 500 })
    }
    const logsOk = (logs ?? []).filter(l => l.estado !== 'failed')
    const logsFailed = (logs ?? []).filter(l => l.estado === 'failed')
    const yaEnviadosIds = new Set(logsOk.map(l => l.vet_id).filter(Boolean))
    const yaEnviadosEmails = new Set(logsOk.map(l => (l.vet_email ?? '').toLowerCase()).filter(Boolean))

    const faltantes = destinatarios.filter(v => {
      if (yaEnviadosIds.has(v.id)) return false
      if (yaEnviadosEmails.has((v.email ?? '').toLowerCase())) return false
      return true
    })

    // Si hay logs con estado='failed' para los que vamos a reintentar, los
    // borramos primero para no dejar duplicados (el nuevo intento insertará
    // un log nuevo con el resultado actualizado).
    const emailsAReintentar = new Set(faltantes.map(v => (v.email ?? '').toLowerCase()))
    const idsLogsFailedAReintentar = logsFailed
      .filter(l => emailsAReintentar.has((l.vet_email ?? '').toLowerCase()))
      .map(l => l.id)
    if (idsLogsFailedAReintentar.length > 0) {
      await supabase.from('mailing_logs').delete().in('id', idsLogsFailedAReintentar)
    }

    if (faltantes.length === 0) {
      // Nada para reanudar: marcamos como enviado completo y devolvemos
      await updateRow('mailing_campanas', idx, { ...campana, estado: 'enviado' })
      return NextResponse.json({
        ok: true,
        nada_para_reanudar: true,
        total_destinatarios: destinatarios.length,
        ya_enviados: destinatarios.length - faltantes.length,
        faltantes: 0,
        enviados_ahora: 0,
      })
    }

    // Marcar como 'enviando' por si venía como 'fallido' / 'cancelado'
    await updateRow('mailing_campanas', idx, { ...campana, estado: 'enviando' })

    let enviados = 0
    let fallidos = 0
    const CHUNK = 100
    const ahora = new Date().toISOString()

    for (let start = 0; start < faltantes.length; start += CHUNK) {
      const chunk = faltantes.slice(start, start + CHUNK)
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
        tracking: { campana_id: String(id), vet_id: String(v.id) },
        attachments: adjuntos.length > 0 ? adjuntos : undefined,
      }))

      const results = await sendBatch(emails)

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
      if (insertErr) console.error('[reanudar] insert logs error:', insertErr.message)
    }

    // Estado final
    const campanas2 = await getSheetData('mailing_campanas')
    const idx2 = campanas2.findIndex(r => r.id === id)
    if (idx2 >= 0) {
      // Calcular total enviados acumulado (original + nuevos)
      const totalEnviados = (parseInt(campanas2[idx2].enviados || '0', 10) || 0) + enviados
      await updateRow('mailing_campanas', idx2, {
        ...campanas2[idx2],
        estado: 'enviado',
        enviados: String(totalEnviados),
        fallidos: String((parseInt(campanas2[idx2].fallidos || '0', 10) || 0) + fallidos),
      })
    }

    return NextResponse.json({
      ok: true,
      total_destinatarios: destinatarios.length,
      ya_enviados_antes: destinatarios.length - faltantes.length,
      faltantes: faltantes.length,
      enviados_ahora: enviados,
      fallidos_ahora: fallidos,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[mailing/reanudar] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
