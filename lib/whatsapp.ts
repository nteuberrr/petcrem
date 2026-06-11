import crypto from 'node:crypto'

/**
 * Cliente mínimo de la WhatsApp Cloud API (Meta directo) para el módulo
 * "Mensajes". Lee credenciales de entorno:
 *  - WHATSAPP_TOKEN              token de acceso (System User permanente recomendado)
 *  - WHATSAPP_PHONE_NUMBER_ID    id del número emisor
 *  - WHATSAPP_API_VERSION        opcional, default 'v22.0'
 *  - META_APP_SECRET             para validar la firma X-Hub-Signature-256 del webhook
 *  - WHATSAPP_VERIFY_TOKEN       string que elegimos nosotros; Meta lo manda al verificar el webhook
 */

const GRAPH = 'https://graph.facebook.com'

function version(): string {
  return process.env.WHATSAPP_API_VERSION || 'v22.0'
}

export function isWhatsappConfigured(): boolean {
  return !!process.env.WHATSAPP_TOKEN && !!process.env.WHATSAPP_PHONE_NUMBER_ID
}

export interface EnvioResult {
  ok: boolean
  message_id?: string
  error?: string
  /** true si el error es por estar fuera de la ventana de 24h (requiere plantilla). */
  fuera_de_ventana?: boolean
}

/** POST genérico a /messages (texto o media). Maneja el error de ventana de 24h. */
async function postMensaje(payload: Record<string, unknown>): Promise<EnvioResult> {
  const token = process.env.WHATSAPP_TOKEN
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!token || !phoneId) return { ok: false, error: 'WhatsApp no configurado' }
  try {
    const res = await fetch(`${GRAPH}/${version()}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...payload }),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg = j?.error?.message || `HTTP ${res.status}`
      // 131047 / "re-engagement message" / "outside the allowed window" → fuera de 24h
      const code = j?.error?.code
      const fuera = code === 131047 || /window|re-engagement|24 hour/i.test(msg)
      return { ok: false, error: msg, fuera_de_ventana: fuera }
    }
    return { ok: true, message_id: j?.messages?.[0]?.id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Envía un texto libre (solo válido dentro de la ventana de 24h). */
export async function enviarTextoWhatsapp(to: string, body: string): Promise<EnvioResult> {
  return postMensaje({ to: to.replace(/[^\d]/g, ''), type: 'text', text: { preview_url: false, body } })
}

/** Número de WhatsApp del admin que confirma/rechaza solicitudes (solo dígitos). */
export function adminWhatsapp(): string {
  return (process.env.ADMIN_WHATSAPP || '56978640811').replace(/\D/g, '')
}

export interface BotonWa { id: string; title: string }

/**
 * Envía un mensaje con botones interactivos de respuesta rápida (máx. 3).
 * Solo válido dentro de la ventana de 24h (igual que el texto libre). El `id`
 * de cada botón vuelve en el webhook como `interactive.button_reply.id`.
 */
export async function enviarBotonesWhatsapp(to: string, body: string, botones: BotonWa[]): Promise<EnvioResult> {
  const buttons = botones.slice(0, 3).map(b => ({
    type: 'reply',
    reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) },
  }))
  return postMensaje({
    to: to.replace(/[^\d]/g, ''),
    type: 'interactive',
    interactive: { type: 'button', body: { text: body.slice(0, 1024) }, action: { buttons } },
  })
}

export type WaMediaTipo = 'image' | 'video' | 'audio' | 'document'

/** Envía un media por URL pública (link); WhatsApp la descarga. Dentro de la ventana de 24h. */
export async function enviarMediaWhatsapp(to: string, opts: { tipo: WaMediaTipo; link: string; caption?: string; filename?: string }): Promise<EnvioResult> {
  const media: Record<string, unknown> = { link: opts.link }
  if (opts.caption && opts.tipo !== 'audio') media.caption = opts.caption
  if (opts.tipo === 'document' && opts.filename) media.filename = opts.filename
  return postMensaje({ to: to.replace(/[^\d]/g, ''), type: opts.tipo, [opts.tipo]: media })
}

/** Decide el tipo de media de WhatsApp (+ nuestro tipo interno) según el mime. */
export function waMediaDeMime(mime: string): { tipo: WaMediaTipo; tipoInterno: string } {
  const m = (mime || '').toLowerCase()
  if (m === 'image/jpeg' || m === 'image/png') return { tipo: 'image', tipoInterno: 'imagen' }
  if (m === 'video/mp4' || m === 'video/3gpp') return { tipo: 'video', tipoInterno: 'video' }
  if (m.startsWith('audio/')) return { tipo: 'audio', tipoInterno: 'audio' }
  return { tipo: 'document', tipoInterno: 'documento' } // pdf, office, gif, webp, etc.
}

/** Verifica la firma HMAC del webhook (X-Hub-Signature-256). */
export function verificarFirmaWebhook(rawBody: string, signature: string | null): boolean {
  const secret = process.env.META_APP_SECRET
  if (!secret) {
    // Sin secret no podemos validar: en producción rechazamos (fail-closed);
    // en dev lo permitimos para no trabar pruebas locales.
    if (process.env.NODE_ENV === 'production') {
      console.error('[whatsapp] META_APP_SECRET no configurado — webhook rechazado (fail-closed en producción)')
      return false
    }
    console.warn('[whatsapp] META_APP_SECRET no configurado — no se valida la firma del webhook')
    return true
  }
  if (!signature) return false
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}

export interface MediaDescargada { buffer: Buffer; mime: string }

/** Resuelve la URL de un media_id y descarga el binario (con el token). */
export async function descargarMedia(mediaId: string): Promise<MediaDescargada | null> {
  const token = process.env.WHATSAPP_TOKEN
  if (!token) return null
  try {
    const meta = await fetch(`${GRAPH}/${version()}/${mediaId}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!meta.ok) return null
    const { url, mime_type } = await meta.json()
    if (!url) return null
    const bin = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!bin.ok) return null
    const buf = Buffer.from(await bin.arrayBuffer())
    return { buffer: buf, mime: mime_type || 'application/octet-stream' }
  } catch (e) {
    console.warn('[whatsapp] error descargando media', mediaId, e)
    return null
  }
}

/** Mapea el tipo de mensaje de Meta a nuestro tipo interno. */
export function tipoInterno(metaType: string): string {
  switch (metaType) {
    case 'text': return 'texto'
    case 'image': return 'imagen'
    case 'audio':
    case 'voice': return 'audio'
    case 'document': return 'documento'
    case 'video': return 'video'
    default: return metaType || 'texto'
  }
}
