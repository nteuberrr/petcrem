import { NextRequest, NextResponse } from 'next/server'
import { Webhook } from 'standardwebhooks'
import { getSheetData, updateRow } from '@/lib/google-sheets'

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

function getEmailFromTo(to: string | string[] | undefined): string {
  if (!to) return ''
  if (Array.isArray(to)) return to[0] || ''
  return to
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

    const logs = await getSheetData('mailing_logs')
    const idx = logs.findIndex(l => l.resend_message_id === messageId)
    if (idx === -1) {
      // No matchea ningún log (puede ser de un test send sin log)
      return NextResponse.json({ ok: true, ignored: true, reason: 'log no encontrado' })
    }
    const log = logs[idx]
    const ts = evt.created_at || new Date().toISOString()

    const updates: Record<string, string> = { ...log }
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

    await updateRow('mailing_logs', idx, updates)

    // Incrementar contador agregado en la campaña
    if (aggField && log.campana_id) {
      const campanas = await getSheetData('mailing_campanas')
      const cIdx = campanas.findIndex(c => c.id === log.campana_id)
      if (cIdx >= 0) {
        const current = parseInt(campanas[cIdx][aggField] || '0', 10) || 0
        await updateRow('mailing_campanas', cIdx, { ...campanas[cIdx], [aggField]: String(current + 1) })
      }
    }

    return NextResponse.json({ ok: true, applied: nuevoEstado })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[webhook resend] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
