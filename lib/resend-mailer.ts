import { Resend } from 'resend'
import { getSheetData } from './datastore'

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
  /** URL pública del archivo (Resend lo baja para adjuntar). Mutuamente excluyente con `content`. */
  path?: string
  /** Contenido binario (Buffer o base64 string). Mutuamente excluyente con `path`. */
  content?: Buffer | string
  content_type?: string
  /** Para imágenes inline referenciadas en el HTML como <img src="cid:xxx" />. */
  content_id?: string
  /** "attachment" (default) o "inline". `inline` + content_id hace que la imagen no aparezca como adjunto. */
  content_disposition?: 'attachment' | 'inline'
}

export interface SendOpts {
  to: string
  subject: string
  html: string
  reply_to?: string
  /** Si se pasa, sobrescribe el From por defecto (útil para envíos transaccionales desde contacto@). */
  from?: string
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
 *
 * Si MAILING_DISABLE_OWN_TRACKING está en 'true' devolvemos el html intacto.
 * Útil cuando Resend (Pro) ya está rastreando aperturas/clicks con su propio
 * tracking subdomain — evita la doble redirección de links (Resend → tu app
 * → destino) y la doble cuenta de aperturas (pixel Resend + pixel propio).
 */
function inyectarTracking(html: string, ids: TrackingIds): string {
  if ((process.env.MAILING_DISABLE_OWN_TRACKING ?? '').toLowerCase() === 'true') {
    return html
  }
  const baseUrl = getPublicBaseUrl()
  if (!baseUrl) {
    console.warn('[resend-mailer] PUBLIC_APP_URL/NEXTAUTH_URL vacíos — tracking propio deshabilitado (pixel + clicks no se inyectan)')
    return html
  }
  if (/localhost|127\.0\.0\.1/i.test(baseUrl)) {
    console.warn(`[resend-mailer] baseUrl apunta a localhost (${baseUrl}) — Gmail/Outlook no podrán cargar el pixel ni resolver clicks. Configurá PUBLIC_APP_URL al dominio público.`)
  }

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
  return attachments.map(a => {
    const payload: Record<string, unknown> = { filename: a.filename }
    if (a.content !== undefined) payload.content = a.content
    if (a.path !== undefined) payload.path = a.path
    if (a.content_type) payload.contentType = a.content_type
    if (a.content_id) payload.contentId = a.content_id
    if (a.content_disposition) payload.contentDisposition = a.content_disposition
    return payload
  })
}

/**
 * "Seguimiento en vivo": correo al que se reenvía copia OCULTA (BCC) de cada
 * email transaccional, si está activo en empresa_config. Cacheado ~60s.
 * Solo aplica a sendEmail (transaccional), NUNCA al mailing masivo (sendBatch).
 */
let segCache: { ts: number; bcc: string | null } | null = null
async function getSeguimientoBcc(): Promise<string | null> {
  try {
    if (segCache && Date.now() - segCache.ts < 60000) return segCache.bcc
    const rows = await getSheetData('empresa_config')
    const row = rows.find(r => r.id === '1') || rows[0]
    const activo = String(row?.email_seguimiento_activo || '').toUpperCase() === 'TRUE'
    const bcc = activo ? sanitizarEmail(row?.email_seguimiento) : null
    segCache = { ts: Date.now(), bcc }
    return bcc
  } catch (e) {
    console.warn('[resend-mailer] no se pudo leer seguimiento de correos:', e)
    return null
  }
}

export async function sendEmail(opts: SendOpts): Promise<SendResult> {
  try {
    const client = getClient()
    const html = prepararHtml(opts)
    const bcc = await getSeguimientoBcc()
    const res = await client.emails.send({
      from: opts.from || getFromAddress(),
      to: opts.to,
      bcc: bcc || undefined,
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

/**
 * Sanitiza una dirección de email: trim, remueve caracteres invisibles
 * (zero-width, NBSP, BOM, etc), valida formato básico. Devuelve null si no
 * es un email enviable.
 */
function sanitizarEmail(raw: string | undefined | null): string | null {
  if (!raw) return null
  let s = String(raw)
  // Quitar caracteres invisibles típicos que rompen el parser de Resend
  s = s.replace(/[​-‍⁠﻿ ]/g, '')
  s = s.trim()
  if (!s) return null
  // Formato básico email@dominio.tld (regex permisivo pero sin espacios ni comas)
  const re = /^[^\s,;<>"()@]+@[^\s,;<>"()@]+\.[^\s,;<>"()@]+$/i
  if (!re.test(s)) return null
  return s
}

/** Pausa N milisegundos. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Detecta errores de rate limit en respuestas de Resend (HTTP 429 o frases típicas). */
function esRateLimit(err: unknown): boolean {
  if (!err) return false
  const obj = err as { statusCode?: number; status?: number; name?: string; message?: string }
  if (obj.statusCode === 429 || obj.status === 429) return true
  const msg = String(obj.message || obj.name || err).toLowerCase()
  return msg.includes('rate limit') || msg.includes('429') || msg.includes('too many request') || msg.includes('quota')
}

/**
 * Envío en lote. Resend limita a 100 emails por request.
 *
 * Robusto contra emails inválidos Y rate limits:
 * - Filtra los emails con formato malo ANTES de mandar (los marca failed local).
 * - Si Resend rechaza el batch entero (típicamente porque uno solo está mal o
 *   por rate limit), reintenta uno por uno con throttle de ~140ms (~7/sec,
 *   por debajo del límite Pro de 10/sec).
 * - Si un email individual devuelve 429, espera con backoff exponencial
 *   (1s, 2s, 4s) y lo reintenta hasta 3 veces.
 */
export async function sendBatch(emails: SendOpts[]): Promise<SendResult[]> {
  if (emails.length === 0) return []
  if (emails.length > 100) throw new Error('sendBatch limitado a 100 emails por llamada')

  // Validación previa: separar válidos de inválidos
  const validos: { idx: number; opts: SendOpts; toLimpio: string }[] = []
  const results: SendResult[] = emails.map(() => ({ ok: false, error: '' }))
  emails.forEach((e, idx) => {
    const limpio = sanitizarEmail(e.to)
    if (!limpio) {
      results[idx] = { ok: false, error: `email inválido o vacío: "${e.to}"` }
    } else {
      validos.push({ idx, opts: { ...e, to: limpio }, toLimpio: limpio })
    }
  })
  if (validos.length === 0) return results

  try {
    const client = getClient()
    const payload = validos.map(v => ({
      from: v.opts.from || getFromAddress(),
      to: v.toLimpio,
      subject: v.opts.subject,
      html: prepararHtml(v.opts),
      replyTo: v.opts.reply_to,
      tags: v.opts.tags,
      attachments: buildAttachmentsPayload(v.opts.attachments),
    }))
    // Intento de batch con retry en caso de rate limit (3 intentos: 0, 2s, 5s)
    let res = await client.batch.send(payload)
    let batchAttempt = 0
    while (res.error && esRateLimit(res.error) && batchAttempt < 2) {
      batchAttempt++
      const wait = batchAttempt === 1 ? 2000 : 5000
      console.warn(`[sendBatch] batch rate-limited, esperando ${wait}ms y reintentando…`)
      await sleep(wait)
      res = await client.batch.send(payload)
    }
    if (res.error || !res.data) {
      const errMsg = res.error?.message || 'batch send falló'
      // FALLBACK: si el batch falla entero (un email malo arrastró al resto),
      // probamos uno por uno para no perder los buenos. Los emails buenos se
      // envían; los problemáticos quedan con error_msg específico de Resend.
      // Throttle entre cada send para no superar el rate limit (Pro: 10/sec).
      console.warn(`[sendBatch] batch falló (${errMsg}), reintentando individual con throttle…`)
      for (let i = 0; i < validos.length; i++) {
        const v = validos[i]
        let attempt = 0
        let lastErr = ''
        let resuelto = false
        while (attempt < 4 && !resuelto) {
          try {
            const single = await client.emails.send(payload[i])
            if (single.error) {
              lastErr = single.error.message || JSON.stringify(single.error)
              if (esRateLimit(single.error) && attempt < 3) {
                const wait = 1000 * Math.pow(2, attempt) // 1s, 2s, 4s
                await sleep(wait)
                attempt++
                continue
              }
              results[v.idx] = { ok: false, error: lastErr }
            } else {
              results[v.idx] = { ok: true, message_id: single.data?.id }
            }
            resuelto = true
          } catch (e) {
            lastErr = e instanceof Error ? e.message : String(e)
            if (esRateLimit(e) && attempt < 3) {
              const wait = 1000 * Math.pow(2, attempt)
              await sleep(wait)
              attempt++
              continue
            }
            results[v.idx] = { ok: false, error: lastErr }
            resuelto = true
          }
        }
        if (!resuelto) {
          results[v.idx] = { ok: false, error: `rate limit tras ${attempt} reintentos: ${lastErr}` }
        }
        // Throttle base entre cada send individual (~7/sec, debajo de 10/sec de Pro)
        await sleep(140)
      }
      return results
    }
    // Batch ok: distribuir message_ids
    res.data.data.forEach((d: { id?: string }, i: number) => {
      results[validos[i].idx] = { ok: true, message_id: d.id }
    })
    return results
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    validos.forEach(v => { results[v.idx] = { ok: false, error: msg } })
    return results
  }
}
