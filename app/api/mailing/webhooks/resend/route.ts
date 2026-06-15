import { NextRequest, NextResponse } from 'next/server'
import { Webhook } from 'standardwebhooks'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase'
import { aplicarEventoCorreo } from '@/lib/correos-log'

interface ResendEvent {
  type: string
  created_at: string
  data: {
    email_id: string
    from?: string
    to?: string | string[]
    subject?: string
    // Resend puede entregar los tags como objeto {name:value} o como arreglo
    // [{name,value}] según la versión — leerTag() maneja ambos.
    tags?: Record<string, string> | Array<{ name: string; value: string }>
    click?: { link?: string; ipAddress?: string; timestamp?: string }
    bounce?: { message?: string; subType?: string }
  }
}

/** Lee un tag por nombre tolerando ambas formas (objeto o arreglo). */
function leerTag(tags: ResendEvent['data']['tags'], name: string): string {
  if (!tags) return ''
  if (Array.isArray(tags)) return tags.find(t => t?.name === name)?.value || ''
  return String(tags[name] || '')
}

/** Mapea el tipo de evento de Resend al estado de correos_cliente (o null). */
function estadoTransaccional(tipo: string): string | null {
  switch (tipo) {
    case 'email.delivered': return 'entregado'
    case 'email.opened': return 'abierto'
    case 'email.clicked': return 'clic'
    case 'email.bounced': return 'rebotado'
    case 'email.complained': return 'spam'
    default: return null
  }
}

export async function POST(req: NextRequest) {
  try {
    const secret = process.env.RESEND_WEBHOOK_SECRET
    const rawBody = await req.text()

    const esProd = process.env.NODE_ENV === 'production'
    const permisivoEnv = (process.env.MAILING_WEBHOOK_PERMISSIVE ?? '').toLowerCase() === 'true'
    if (permisivoEnv && esProd) {
      console.error('[webhook] MAILING_WEBHOOK_PERMISSIVE=true está seteado en PRODUCCIÓN — se ignora (la firma inválida rechaza igual). Quitar la variable de Vercel.')
    }
    // El modo permisivo solo aplica fuera de producción.
    const permisivo = permisivoEnv && !esProd
    let evt: ResendEvent
    let firmaValida: boolean | null = null
    if (secret) {
      try {
        const wh = new Webhook(secret)
        const headers = {
          'svix-id': req.headers.get('svix-id') || '',
          'svix-timestamp': req.headers.get('svix-timestamp') || '',
          'svix-signature': req.headers.get('svix-signature') || '',
        }
        evt = wh.verify(rawBody, headers) as ResendEvent
        firmaValida = true
      } catch (verifyErr) {
        firmaValida = false
        const errMsg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr)
        if (permisivo) {
          // Modo desbloqueo: procesamos igual aunque la firma no matchea. Útil
          // cuando el secret en Vercel y en Resend no coinciden por algún motivo
          // (copy/paste roto, rotación, etc) y necesitás que las métricas anden.
          console.warn(`[webhook] firma inválida pero MAILING_WEBHOOK_PERMISSIVE=true, procesando igual: ${errMsg}`)
          try {
            evt = JSON.parse(rawBody) as ResendEvent
          } catch {
            return NextResponse.json({ ok: true, ignored: true, reason: 'body no parseable' })
          }
        } else {
          console.warn('[webhook] firma inválida (MAILING_WEBHOOK_PERMISSIVE=true permite procesar igual, solo fuera de producción):', errMsg)
          return NextResponse.json({ error: 'firma inválida' }, { status: 401 })
        }
      }
    } else {
      if (esProd) {
        // Fail-closed: sin secret no procesamos nada en producción.
        console.error('[webhook] RESEND_WEBHOOK_SECRET no configurado — webhook rechazado (fail-closed en producción)')
        return NextResponse.json({ error: 'RESEND_WEBHOOK_SECRET no configurado' }, { status: 503 })
      }
      console.warn('[webhook] RESEND_WEBHOOK_SECRET no configurado — aceptando sin verificar (dev)')
      evt = JSON.parse(rawBody) as ResendEvent
    }
    void firmaValida  // disponible si más adelante queremos marcar el log

    const messageId = evt.data?.email_id
    if (!messageId) {
      return NextResponse.json({ ok: true, ignored: true, reason: 'sin email_id' })
    }
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ ok: true, ignored: true, reason: 'supabase no configurado' })
    }

    // Correos transaccionales al tutor (registro / inicio cremación / inicio
    // despacho / entrega / certificado): llevan tag tipo="cliente_*" y se
    // reconcilian en correos_cliente, NO en mailing_logs (que es de campañas).
    const tipoTag = leerTag(evt.data?.tags, 'tipo')
    if (tipoTag.startsWith('cliente_')) {
      const estado = estadoTransaccional(evt.type)
      if (!estado) return NextResponse.json({ ok: true, ignored: true, type: evt.type })
      const ts = evt.created_at || new Date().toISOString()
      const motivo = evt.type === 'email.bounced' ? (evt.data.bounce?.message || evt.data.bounce?.subType || '') : ''
      const found = await aplicarEventoCorreo(messageId, estado, motivo, ts)
      return NextResponse.json({ ok: true, transaccional: true, applied: found ? estado : null })
    }

    // Race condition guard: el endpoint /enviar hace sendBatch ANTES de hacer
    // INSERT de los logs. Resend a veces dispara el webhook antes de que el
    // insert termine. Reintentamos buscar el log con backoff exponencial.
    type LogRow = { id: string; campana_id: string; fecha_entrega: string | null; fecha_apertura: string | null; fecha_click: string | null }
    const supabase = getSupabase()
    const MAX_ATTEMPTS = 5
    const DELAYS_MS = [0, 800, 1800, 3500, 6500]  // total ~12.6s
    let log: LogRow | null = null
    let lastSelErr: string | null = null
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (DELAYS_MS[attempt] > 0) {
        await new Promise(r => setTimeout(r, DELAYS_MS[attempt]))
      }
      const { data: logs, error: selErr } = await supabase
        .from('mailing_logs')
        .select('id, campana_id, fecha_entrega, fecha_apertura, fecha_click')
        .eq('resend_message_id', messageId)
        .limit(1)
      if (selErr) {
        lastSelErr = selErr.message
        console.warn(`[webhook] select intento ${attempt + 1}/${MAX_ATTEMPTS}:`, selErr.message)
        continue
      }
      if (logs && logs.length > 0) {
        log = logs[0] as unknown as LogRow
        break
      }
    }
    if (!log) {
      // No está en mailing_logs. Fallback: puede ser un correo transaccional al
      // tutor cuyo tag no llegó en el payload → intentamos correos_cliente.
      const estadoTx = estadoTransaccional(evt.type)
      if (estadoTx) {
        const ts = evt.created_at || new Date().toISOString()
        const motivo = evt.type === 'email.bounced' ? (evt.data.bounce?.message || evt.data.bounce?.subType || '') : ''
        const found = await aplicarEventoCorreo(messageId, estadoTx, motivo, ts)
        if (found) return NextResponse.json({ ok: true, transaccional: true, applied: estadoTx })
      }
      // Devolvemos 200 para que Resend no marque failed_attempts. Es esperado:
      // o el log nunca se insertó (test, email manual no de campaña) o tardó
      // demasiado. Loggeamos para visibility.
      console.warn(`[webhook] log no encontrado tras ${MAX_ATTEMPTS} intentos para message_id=${messageId} (tipo=${evt.type}). Último error select: ${lastSelErr ?? 'ninguno'}`)
      return NextResponse.json({ ok: true, ignored: true, reason: 'log no encontrado', message_id: messageId })
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

    // NOTA: NO actualizamos contadores en mailing_campanas desde acá. Antes lo
    // hacíamos, pero con 500+ destinatarios y 4-5 eventos cada uno (sent,
    // delivered, opened, clicked, bounced) se generan miles de read+write
    // contra Sheets en pocos minutos y revienta la cuota (60 reads/min/user).
    // Los contadores los calcula on-demand /api/mailing/campanas desde
    // Supabase agregando los logs por estado.
    void aggField

    return NextResponse.json({ ok: true, applied: nuevoEstado })
  } catch (e) {
    // Importante: devolvemos 200 OK incluso ante errores transitorios para que
    // Resend NO acumule failed_attempts y termine deshabilitando el webhook.
    // Loggeamos para visibility en Vercel; los eventos siguen estando en
    // Resend → Webhook → Replay si los necesitamos.
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[webhook resend] error capturado (devolvemos 200):', msg)
    return NextResponse.json({ ok: true, error: msg, swallowed: true })
  }
}
