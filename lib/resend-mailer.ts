import { Resend } from 'resend'
import { getSheetData } from './datastore'
import { registrarCorreoLog } from './correos-audit'

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

export interface SeguimientoMeta {
  /** Key del catálogo (lib/correos-catalogo), p.ej. 'cliente_registro'. */
  tipo: string
  audiencia?: 'Tutor' | 'Veterinario'
  codigo?: string
  nombre?: string
  clienteId?: string
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
  /**
   * Si es true, NO se agrega el BCC de "seguimiento en vivo" a este envío.
   * Úsalo en correos con adjuntos sensibles o pesados (certificado con video,
   * informe de facturación de un vet) para no filtrar PII de terceros ni
   * duplicar archivos grandes a la casilla de seguimiento.
   */
  noBcc?: boolean
  /**
   * Solo para sendBatch: OPT-IN al BCC de "seguimiento en vivo". En batch el BCC
   * está apagado por defecto (las campañas masivas usan sendBatch y no queremos
   * 500 copias en la casilla de seguimiento). Los correos de ETAPA al tutor que
   * van en lote (inicio de cremación, "vamos en camino") lo activan para que el
   * seguimiento los cubra igual que a los de sendEmail. Se respeta `noBcc`.
   */
  bccSeguimiento?: boolean
  /**
   * Metadatos de un correo TRANSACCIONAL (no mailing). Si se pasa:
   *  - el BCC de seguimiento se decide POR TIPO (config en empresa_config), y
   *  - el correo se registra en correos_log (respaldo, con su HTML, sin adjuntos).
   * Las campañas de mailing NO lo pasan → quedan fuera del registro.
   */
  seguimiento?: SeguimientoMeta
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

/**
 * Descarga un adjunto remoto (path) a bytes, con reintentos y timeout. Devuelve
 * null si no se pudo bajar tras `intentos`. La descarga la hace NUESTRO server
 * (a R2), que es más confiable que dejar que Resend/SES la haga en el momento
 * del envío.
 */
async function descargarAdjunto(url: string, intentos = 3): Promise<Buffer | null> {
  for (let i = 0; i < intentos; i++) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 25000)
      const res = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const ab = await res.arrayBuffer()
      return Buffer.from(ab)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (i === intentos - 1) {
        console.warn(`[resend-mailer] no se pudo descargar el adjunto ${url} tras ${intentos} intentos: ${msg}`)
        return null
      }
      await sleep(500 * (i + 1))
    }
  }
  return null
}

/**
 * Materializa los adjuntos remotos (`path`) a `content` (bytes) ANTES de enviar.
 *
 * Motivo: cuando se pasa un `path` (URL), Resend/SES intenta DESCARGAR el archivo
 * en el momento del envío. Esa descarga remota falla de forma intermitente
 * (evento email.failed → el correo no se entrega y el tutor no recibe nada),
 * sobre todo con adjuntos ~10MB como los videos del servicio. Al mandar los
 * bytes en `content`, Resend solo los relaya: no hay paso de descarga que pueda
 * fallar. Si NUESTRA descarga falla, dejamos el `path` como fallback (no peor
 * que antes). `cache` deduplica descargas de una misma URL dentro de un batch.
 */
async function materializarAttachments(
  specs: AttachmentSpec[] | undefined,
  cache?: Map<string, Promise<Buffer | null>>,
): Promise<AttachmentSpec[] | undefined> {
  if (!specs || specs.length === 0) return specs
  const out: AttachmentSpec[] = []
  for (const a of specs) {
    if (a.content !== undefined || !a.path) { out.push(a); continue }
    let p = cache?.get(a.path)
    if (!p) { p = descargarAdjunto(a.path); cache?.set(a.path, p) }
    const buf = await (p ?? descargarAdjunto(a.path))
    if (buf) {
      out.push({ ...a, content: buf, path: undefined })
    } else {
      out.push(a) // fallback: dejamos el path y que Resend intente bajarlo
    }
  }
  return out
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
 * En sendEmail aplica por defecto (opt-out con `noBcc`). En sendBatch aplica
 * SOLO a los items con `bccSeguimiento: true` (opt-in) — así cubre los correos
 * de etapa al tutor sin inundar la casilla con las campañas masivas.
 */
interface SeguimientoConfig { activo: boolean; emails: string[]; tipos: Record<string, boolean> }
let segCache: { ts: number; cfg: SeguimientoConfig } | null = null

/** Parsea uno o VARIOS correos de seguimiento (separados por coma o punto y coma). */
function parseEmailsSeguimiento(raw: string | undefined | null): string[] {
  if (!raw) return []
  const vistos = new Set<string>()
  for (const parte of String(raw).split(/[,;\n]/)) {
    const e = sanitizarEmail(parte)
    if (e) vistos.add(e.toLowerCase())
  }
  return [...vistos]
}

async function getSeguimientoConfig(): Promise<SeguimientoConfig> {
  if (segCache && Date.now() - segCache.ts < 60000) return segCache.cfg
  try {
    const rows = await getSheetData('empresa_config')
    const row = rows.find(r => r.id === '1') || rows[0]
    const activo = String(row?.email_seguimiento_activo || '').toUpperCase() === 'TRUE'
    const emails = activo ? parseEmailsSeguimiento(row?.email_seguimiento) : []
    let tipos: Record<string, boolean> = {}
    try {
      const parsed = JSON.parse(row?.seguimiento_tipos || '{}')
      if (parsed && typeof parsed === 'object') tipos = parsed as Record<string, boolean>
    } catch { /* JSON inválido → se asume todos los tipos ON */ }
    const cfg: SeguimientoConfig = { activo, emails, tipos }
    segCache = { ts: Date.now(), cfg }
    return cfg
  } catch (e) {
    console.warn('[resend-mailer] no se pudo leer seguimiento de correos:', e)
    return { activo: false, emails: [], tipos: {} }
  }
}

/**
 * BCC de seguimiento para un correo (uno o varios destinatarios). null si el master
 * está apagado, si no hay direcciones, o si el TIPO está desactivado en la config.
 */
async function getSeguimientoBcc(tipo?: string): Promise<string[] | null> {
  const c = await getSeguimientoConfig()
  if (!c.activo || c.emails.length === 0) return null
  if (tipo && c.tipos[tipo] === false) return null
  return c.emails
}

/** Registra el envío en correos_log si el correo trae metadatos de seguimiento. */
async function logSeguimiento(
  opts: SendOpts,
  html: string,
  res: { ok: boolean; messageId?: string; error?: string },
): Promise<void> {
  const s = opts.seguimiento
  if (!s) return
  await registrarCorreoLog({
    tipo: s.tipo,
    audiencia: s.audiencia,
    destinatario: opts.to,
    asunto: opts.subject,
    codigo: s.codigo,
    nombre: s.nombre,
    clienteId: s.clienteId,
    messageId: res.messageId,
    ok: res.ok,
    error: res.error,
    html,
  })
}

/** Registra en correos_log cada item del batch que traiga seguimiento. */
async function logBatchSeguimiento(
  items: { idx: number; opts: SendOpts }[],
  htmls: string[],
  results: SendResult[],
): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    const o = items[i].opts
    if (!o.seguimiento) continue
    const r = results[items[i].idx]
    await logSeguimiento(o, htmls[i] ?? o.html, { ok: r.ok, messageId: r.message_id, error: r.error })
  }
}

export async function sendEmail(opts: SendOpts): Promise<SendResult> {
  const html = prepararHtml(opts)
  try {
    const client = getClient()
    const bcc = opts.noBcc ? null : await getSeguimientoBcc(opts.seguimiento?.tipo)
    const materializados = await materializarAttachments(opts.attachments)
    const res = await client.emails.send({
      from: opts.from || getFromAddress(),
      to: opts.to,
      bcc: bcc && bcc.length ? bcc : undefined,
      subject: opts.subject,
      html,
      replyTo: opts.reply_to,
      tags: opts.tags,
      attachments: buildAttachmentsPayload(materializados),
    })
    if (res.error) {
      const error = res.error.message || JSON.stringify(res.error)
      await logSeguimiento(opts, html, { ok: false, error })
      return { ok: false, error }
    }
    await logSeguimiento(opts, html, { ok: true, messageId: res.data?.id })
    return { ok: true, message_id: res.data?.id }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await logSeguimiento(opts, html, { ok: false, error })
    return { ok: false, error }
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

  // HTML preparado por item (fuera del try → disponible para el logging en todos
  // los caminos de retorno, incluido el catch).
  const htmls = validos.map(v => prepararHtml(v.opts))

  try {
    const client = getClient()
    // BCC de seguimiento: solo si algún item lo pide explícitamente (opt-in) y el
    // tipo no está desactivado en la config por-tipo. Se lee una vez (cacheado).
    const segCfg = validos.some(v => v.opts.bccSeguimiento && !v.opts.noBcc)
      ? await getSeguimientoConfig()
      : null
    const bccDe = (o: SendOpts): string[] | undefined => {
      if (!o.bccSeguimiento || o.noBcc || !segCfg?.activo || segCfg.emails.length === 0) return undefined
      if (o.seguimiento?.tipo && segCfg.tipos[o.seguimiento.tipo] === false) return undefined
      return segCfg.emails
    }
    // Materializamos adjuntos remotos a bytes (una sola descarga por URL en todo
    // el batch) para no depender de la descarga remota de Resend/SES.
    const attCache = new Map<string, Promise<Buffer | null>>()
    const attMaterializadas = await Promise.all(
      validos.map(v => materializarAttachments(v.opts.attachments, attCache)),
    )
    const payload = validos.map((v, i) => ({
      from: v.opts.from || getFromAddress(),
      to: v.toLimpio,
      bcc: bccDe(v.opts),
      subject: v.opts.subject,
      html: htmls[i],
      replyTo: v.opts.reply_to,
      tags: v.opts.tags,
      attachments: buildAttachmentsPayload(attMaterializadas[i]),
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
      await logBatchSeguimiento(validos, htmls, results)
      return results
    }
    // Batch ok: distribuir message_ids
    res.data.data.forEach((d: { id?: string }, i: number) => {
      results[validos[i].idx] = { ok: true, message_id: d.id }
    })
    await logBatchSeguimiento(validos, htmls, results)
    return results
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    validos.forEach(v => { results[v.idx] = { ok: false, error: msg } })
    await logBatchSeguimiento(validos, htmls, results)
    return results
  }
}
