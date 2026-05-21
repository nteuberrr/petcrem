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

export interface SendOpts {
  to: string
  subject: string
  html: string
  reply_to?: string
  /** Texto que aparece en el inbox al lado del asunto (se inyecta como span invisible). */
  preview_text?: string
  /** Tags para correlacionar webhooks con la campaña (Resend permite hasta 10 tags). */
  tags?: Array<{ name: string; value: string }>
}

/**
 * Inyecta el preview text como un div oculto al inicio del HTML.
 * Gmail/Outlook leen los primeros caracteres visibles para mostrar como preview en el inbox.
 * El padding con zero-width chars evita que se filtre texto subsiguiente.
 */
function inyectarPreviewText(html: string, previewText: string): string {
  const txt = previewText.trim()
  if (!txt) return html
  const escaped = txt
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  // Padding amplio para que el body no se filtre en el preview del inbox.
  // Mezclamos zero-width-joiners + zero-width-non-joiners (invisibles, no se renderizan
  // como espacio en ningún cliente) en lugar de nbsp que algunos clientes muestran.
  const padding = ('&zwnj;&zwj;'.repeat(200))
  const previewDiv = `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;visibility:hidden;line-height:0;color:transparent;opacity:0;font-size:1px;">${escaped} ${padding}</div>`
  // Si el HTML tiene <body>, lo insertamos justo después; si no, al inicio.
  const bodyMatch = html.match(/<body[^>]*>/i)
  if (bodyMatch) {
    const idx = (bodyMatch.index ?? 0) + bodyMatch[0].length
    return html.slice(0, idx) + previewDiv + html.slice(idx)
  }
  return previewDiv + html
}

export interface SendResult {
  ok: boolean
  message_id?: string
  error?: string
}

export async function sendEmail(opts: SendOpts): Promise<SendResult> {
  try {
    const client = getClient()
    const html = opts.preview_text ? inyectarPreviewText(opts.html, opts.preview_text) : opts.html
    const res = await client.emails.send({
      from: getFromAddress(),
      to: opts.to,
      subject: opts.subject,
      html,
      replyTo: opts.reply_to,
      tags: opts.tags,
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
      html: e.preview_text ? inyectarPreviewText(e.html, e.preview_text) : e.html,
      replyTo: e.reply_to,
      tags: e.tags,
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
