import { NextRequest, NextResponse } from 'next/server'
import { Webhook } from 'standardwebhooks'
import { getSheetData, updateRow } from '@/lib/google-sheets'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase'

interface ResendEvent {
  type: string
  created_at: string
  data: {
    email_id: string
    from?: string
    to?: string | string[]
    subject?: string
    tags?: Record<string, string>
    click?: { link?: string; ipAddress?: string; timestamp?: string }
    bounce?: { message?: string; subType?: string }
  }
}

export async function POST(req: NextRequest) {
  try {
    const secret = process.env.RESEND_WEBHOOK_SECRET
    const rawBody = await req.text()

    let evt: ResendEvent
    if (secret) {
      try {
        const wh = new Webhook(secret)
        const headers = {
          'svix-id': req.headers.get('svix-id') || '',
          'svix-timestamp': req.headers.get('svix-timestamp') || '',
          'svix-signature': req.headers.get('svix-signature') || '',
        }
        evt = wh.verify(rawBody, headers) as ResendEvent
      } catch (verifyErr) {
        console.warn('[webhook] firma inválida:', verifyErr)
        return NextResponse.json({ error: 'firma inválida' }, { status: 401 })
      }
    } else {
      console.warn('[webhook] RESEND_WEBHOOK_SECRET no configurado — aceptando sin verificar (dev)')
      evt = JSON.parse(rawBody) as ResendEvent
    }

    const messageId = evt.data?.email_id
    if (!messageId) {
      return NextResponse.json({ ok: false, reason: 'sin email_id' })
    }
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ ok: false, reason: 'supabase no configurado' })
    }

    const supabase = getSupabase()
    const { data: logs, error: selErr } = await supabase
      .from('mailing_logs')
      .select('id, campana_id, fecha_entrega, fecha_apertura, fecha_click')
      .eq('resend_message_id', messageId)
      .limit(1)
    if (selErr) {
      console.error('[webhook] select error:', selErr.message)
      return NextResponse.json({ error: selErr.message }, { status: 500 })
    }
    const log = logs?.[0]
    if (!log) {
      return NextResponse.json({ ok: true, ignored: true, reason: 'log no encontrado' })
    }

    const ts = evt.created_at || new Date().toISOString()
    const updates: Record<string, string | null> = {}
    let aggField: 'entregados' | 'aperturas' | 'clicks' | 'rebotes' | 'spam' | null = null
    let nuevoEstado: string | null = null

    switch (evt.type) {
      case 'email.delivered':
        if (!log.fecha_entrega) {
          updates.fecha_entrega = ts
          updates.estado = 'delivered'
          aggField = 'entregados'
          nuevoEstado = 'delivered'
        }
        break
      case 'email.opened':
        if (!log.fecha_apertura) {
          updates.fecha_apertura = ts
          updates.estado = 'opened'
          aggField = 'aperturas'
          nuevoEstado = 'opened'
        }
        break
      case 'email.clicked':
        if (!log.fecha_click) {
          updates.fecha_click = ts
          updates.estado = 'clicked'
          updates.url_clickeada = evt.data.click?.link || ''
          aggField = 'clicks'
          nuevoEstado = 'clicked'
        }
        break
      case 'email.bounced':
        updates.fecha_rebote = ts
        updates.estado = 'bounced'
        updates.motivo_rebote = evt.data.bounce?.message || evt.data.bounce?.subType || ''
        aggField = 'rebotes'
        nuevoEstado = 'bounced'
        break
      case 'email.complained':
        updates.estado = 'complained'
        aggField = 'spam'
        nuevoEstado = 'complained'
        break
      default:
        return NextResponse.json({ ok: true, ignored: true, type: evt.type })
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: true, dedup: true })
    }

    const { error: updErr } = await supabase.from('mailing_logs').update(updates).eq('id', log.id)
    if (updErr) console.error('[webhook] update error:', updErr.message)

    // Incrementar contador agregado en la campaña (Sheets sigue siendo source de truth de resumen)
    if (aggField && log.campana_id) {
      try {
        const campanas = await getSheetData('mailing_campanas')
        const cIdx = campanas.findIndex(c => c.id === log.campana_id)
        if (cIdx >= 0) {
          const current = parseInt(campanas[cIdx][aggField] || '0', 10) || 0
          await updateRow('mailing_campanas', cIdx, { ...campanas[cIdx], [aggField]: String(current + 1) })
        }
      } catch (err) {
        console.error('[webhook] agg update error:', err)
      }
    }

    return NextResponse.json({ ok: true, applied: nuevoEstado })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[webhook resend] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
