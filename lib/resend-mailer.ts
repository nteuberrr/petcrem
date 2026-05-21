import { Resend } from 'resend'

let cached: Resend | null = null

function getClient(): Resend {
  if (cached) return cached
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('RESEND_API_KEY no configurada')
  cached = new Resend(key)
  return cached
}

export function isResendConfigured(): boolean {
  return !!process.env.RESEND_API_KEY
}

export function getFromAddress(): string {
  const email = process.env.MAILING_FROM_EMAIL || 'onboarding@resend.dev'
  const name = process.env.MAILING_FROM_NAME || 'Alma Animal'
  return `${name} <${email}>`
}

/** Base URL pública para los endpoints de tracking. Configurable vía env, fallback NEXTAUTH_URL. */
function getPublicBaseUrl(): string {
  const v = process.env.PUBLIC_APP_URL || process.env.NEXTAUTH_URL || ''
  return v.replace(/\/+$/, '')
}

export interface TrackingIds {
  campana_id: string
  vet_id: string
}

export interface AttachmentSpec {
  filename: string
  /** URL pública del archivo (Resend lo baja para adjuntar). */
  path: string
  content_type?: string
}

export interface SendOpts {
  to: string
  subject: string
  html: string
  reply_to?: string
  /** Texto que aparece en el inbox al lado del asunto (se inyecta como span invisible). */
  preview_text?: string
  /** Tags para correlacionar webhooks con la campaña (Resend permite hasta 10 tags). */
  tags?: Array<{ name: string; value: string }>
  /** Si se pasa, inyectamos píxel de apertura + reescribimos links para click tracking. */
  tracking?: TrackingIds
  /** Adjuntos via URL pública (R2). */
  attachments?: AttachmentSpec[]
}

/**
 * Inyecta el preview text como un div oculto al inicio del HTML.
 * Gmail/Outlook leen los primeros caracteres visibles para mostrar como preview en el inbox.
 */
function inyectarPreviewText(html: string, previewText: string): string {
  const txt = previewText.trim()
  if (!txt) return html
  const escaped = txt
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const padding = ('&zwnj;&zwj;'.repeat(200))
  const previewDiv = `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;visibility:hidden;line-height:0;color:transparent;opacity:0;font-size:1px;">${escaped} ${padding}</div>`
  const bodyMatch = html.match(/<body[^>]*>/i)
  if (bodyMatch) {
    const idx = (bodyMatch.index ?? 0) + bodyMatch[0].length
    return html.slice(0, idx) + previewDiv + html.slice(idx)
  }
  return previewDiv + html
}

/**
 * Inyecta el píxel 1x1 invisible al final del body para tracking de aperturas
 * y reescribe todos los <a href="http..."> para que pasen por nuestro endpoint de click.
 */
function inyectarTracking(html: string, ids: TrackingIds): string {
  const baseUrl = getPublicBaseUrl()
  if (!baseUrl) return html  // sin baseUrl no podemos hacer tracking propio

  let resultado = html

  // 1. Reescribir links — solo http/https, no mailto / tel / anchor / our own URLs
  resultado = resultado.replace(/<a\s+([^>]*?)href=(["'])([^"']+)\2/gi, (match, before, quote, url) => {
    // Solo reescribir http(s) externos. Saltear mailto/tel/anchors/etc.
    if (!/^https?:\/\//i.test(url)) return match
    // No reescribir links que apunten a nuestro propio dominio de tracking (anti-loop)
    if (url.startsWith(baseUrl)) return match
    const wrapped = `${baseUrl}/api/mailing/click/${encodeURIComponent(ids.campana_id)}/${encodeURIComponent(ids.vet_id)}?u=${encodeURIComponent(url)}`
    return `<a ${before}href=${quote}${wrapped}${quote}`
  })

  // 2. Inyectar píxel al final del <body> (o al final del HTML si no hay body cerrado).
  const pixelUrl = `${baseUrl}/api/mailing/pixel/${encodeURIComponent(ids.campana_id)}/${encodeURIComponent(ids.vet_id)}`
  const pixelTag = `<img src="${pixelUrl}" alt="" width="1" height="1" style="display:block;border:0;width:1px;height:1px;" />`
  const bodyCloseMatch = resultado.match(/<\/body>/i)
  if (bodyCloseMatch) {
    resultado = resultado.slice(0, bodyCloseMatch.index) + pixelTag + resultado.slice(bodyCloseMatch.index!)
  } else {
    resultado = resultado + pixelTag
  }

  return resultado
}

function prepararHtml(opts: SendOpts): string {
  let html = opts.html
  if (opts.tracking) html = inyectarTracking(html, opts.tracking)
  if (opts.preview_text) html = inyectarPreviewText(html, opts.preview_text)
  return html
}

export interface SendResult {
  ok: boolean
  message_id?: string
  error?: string
}

function buildAttachmentsPayload(attachments: AttachmentSpec[] | undefined) {
  if (!attachments || attachments.length === 0) return undefined
  return attachments.map(a => ({ filename: a.filename, path: a.path, contentType: a.content_type }))
}

export async function sendEmail(opts: SendOpts): Promise<SendResult> {
  try {
    const client = getClient()
    const html = prepararHtml(opts)
    const res = await client.emails.send({
      from: getFromAddress(),
      to: opts.to,
      subject: opts.subject,
      html,
      replyTo: opts.reply_to,
      tags: opts.tags,
      attachments: buildAttachmentsPayload(opts.attachments),
    })
    if (res.error) {
      return { ok: false, error: res.error.message || JSON.stringify(res.error) }
    }
    return { ok: true, message_id: res.data?.id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Envío en lote. Resend limita a 100 emails por request. */
export async function sendBatch(emails: SendOpts[]): Promise<SendResult[]> {
  if (emails.length === 0) return []
  if (emails.length > 100) throw new Error('sendBatch limitado a 100 emails por llamada')
  try {
    const client = getClient()
    const payload = emails.map(e => ({
      from: getFromAddress(),
      to: e.to,
      subject: e.subject,
      html: prepararHtml(e),
      replyTo: e.reply_to,
      tags: e.tags,
      attachments: buildAttachmentsPayload(e.attachments),
    }))
    const res = await client.batch.send(payload)
    if (res.error || !res.data) {
      const errMsg = res.error?.message || 'batch send falló'
      return emails.map(() => ({ ok: false, error: errMsg }))
    }
    return res.data.data.map((d: { id?: string }) => ({ ok: true, message_id: d.id }))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return emails.map(() => ({ ok: false, error: msg }))
  }
}
