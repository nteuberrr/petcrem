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

// ─── Plantillas aprobadas (fuera de la ventana de 24h) ─────────────────────────
// Las plantillas son el ÚNICO mensaje que Meta permite iniciar/enviar con la
// ventana de 24h cerrada, y se cobran por mensaje (utility barata, marketing más
// cara). Regla del sistema: texto libre PRIMERO (gratis, dentro de ventana) y
// plantilla solo como respaldo ante `fuera_de_ventana`. Este catálogo es la única
// fuente de verdad: lo consumen el script de creación (scripts/crear-plantillas-
// whatsapp.ts), los senders y el render para registrar el texto real en el inbox.
// ⚠️ El `texto` debe calzar EXACTO con lo aprobado en Meta: si se edita acá hay
// que re-crear/re-aprobar la plantilla (Meta rechaza el envío si difiere).

export interface PlantillaWa {
  nombre: string
  categoria: 'UTILITY' | 'MARKETING'
  /** Cuerpo con variables posicionales {{1}}, {{2}}… tal cual se aprueba en Meta. */
  texto: string
  /** Valores de ejemplo (los exige Meta al crear, uno por variable). */
  ejemplos: string[]
}

export const PLANTILLAS_WA: Record<string, PlantillaWa> = {
  retomar_conversacion: {
    nombre: 'retomar_conversacion',
    categoria: 'UTILITY',
    texto: 'Hola {{1}}, te escribimos de Crematorio Alma Animal para retomar tu conversación. Tenemos información pendiente sobre tu solicitud. Responde este mensaje y seguimos conversando por aquí.',
    ejemplos: ['María'],
  },
  seguimiento_consulta: {
    nombre: 'seguimiento_consulta',
    categoria: 'MARKETING',
    texto: 'Hola {{1}}, hace poco nos consultaste por nuestros servicios. Quedamos atentos si necesitas ayuda para coordinar un retiro o resolver cualquier duda. Estamos disponibles todos los días de 09:00 a 22:00 hrs.',
    ejemplos: ['María'],
  },
  retiro_confirmado: {
    nombre: 'retiro_confirmado',
    categoria: 'UTILITY',
    texto: 'Hola {{1}}, confirmamos el retiro de {{2}} para {{3}}. Ante cualquier cambio, respóndenos por aquí. Gracias por confiar en Crematorio Alma Animal.',
    ejemplos: ['María', 'Rocky', 'hoy a las 18:00'],
  },
  entrega_en_camino: {
    nombre: 'entrega_en_camino',
    categoria: 'UTILITY',
    texto: 'Hola {{1}}, vamos en camino a entregar las cenizas de {{2}}. Te avisaremos cuando estemos por llegar. — Crematorio Alma Animal',
    ejemplos: ['María', 'Rocky'],
  },
  certificado_disponible: {
    nombre: 'certificado_disponible',
    categoria: 'UTILITY',
    texto: 'Hola {{1}}, el certificado de cremación de {{2}} ya está emitido y fue enviado a tu correo. Si no lo recibes, respóndenos por aquí y te lo reenviamos.',
    ejemplos: ['María', 'Rocky'],
  },
  aviso_operativo: {
    nombre: 'aviso_operativo',
    categoria: 'UTILITY',
    // Meta no permite variables al inicio ni al final del cuerpo → cierre fijo.
    texto: 'Aviso del sistema Alma Animal: {{1}}. Responde este mensaje para reabrir la conversación con el bot.',
    ejemplos: ['Nueva solicitud de retiro pendiente de confirmar'],
  },
}

const IDIOMA_PLANTILLAS = 'es'

/** Sustituye {{1}}, {{2}}… — para registrar en el inbox el texto real que recibió la persona. */
export function renderPlantillaWa(nombre: string, variables: string[]): string {
  const p = PLANTILLAS_WA[nombre]
  if (!p) return ''
  return p.texto.replace(/\{\{(\d+)\}\}/g, (_, n) => variables[Number(n) - 1] ?? '')
}

/**
 * Envía una plantilla aprobada (funciona con la ventana de 24h cerrada; tiene
 * costo por mensaje). `nombre` debe existir en PLANTILLAS_WA y estar APROBADA
 * en Meta. Las variables van posicionales ({{1}}, {{2}}…).
 */
export async function enviarPlantillaWhatsapp(to: string, nombre: string, variables: string[]): Promise<EnvioResult> {
  const p = PLANTILLAS_WA[nombre]
  if (!p) return { ok: false, error: `Plantilla desconocida: ${nombre}` }
  const esperadas = (p.texto.match(/\{\{\d+\}\}/g) || []).length
  if (variables.length < esperadas) return { ok: false, error: `La plantilla ${nombre} espera ${esperadas} variable(s), llegaron ${variables.length}.` }
  const template: Record<string, unknown> = { name: nombre, language: { code: IDIOMA_PLANTILLAS } }
  if (esperadas > 0) {
    template.components = [{ type: 'body', parameters: variables.slice(0, esperadas).map(v => ({ type: 'text', text: String(v).slice(0, 500) })) }]
  }
  return postMensaje({ to: to.replace(/[^\d]/g, ''), type: 'template', template })
}

export interface PlantillaEstado {
  nombre: string
  estado: string // APPROVED | PENDING | REJECTED | …
  categoria: string
  idioma: string
}

/** Lista las plantillas de la WABA con su estado de revisión en Meta. */
export async function listarPlantillasWhatsapp(): Promise<PlantillaEstado[]> {
  const token = process.env.WHATSAPP_TOKEN
  const waba = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID
  if (!token || !waba) return []
  try {
    const res = await fetch(`${GRAPH}/${version()}/${waba}/message_templates?fields=name,status,category,language&limit=100`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) {
      console.warn('[whatsapp] no se pudieron listar plantillas:', j?.error?.message || res.status)
      return []
    }
    return (j.data || []).map((t: { name?: string; status?: string; category?: string; language?: string }) => ({
      nombre: String(t.name || ''), estado: String(t.status || ''), categoria: String(t.category || ''), idioma: String(t.language || ''),
    }))
  } catch (e) {
    console.warn('[whatsapp] error listando plantillas:', e)
    return []
  }
}

/** Nombres de plantillas APROBADAS en Meta (cache corto: evita pegarle a Graph en cada envío). */
let aprobadasCache: { ts: number; nombres: Set<string> } | null = null
export async function plantillasAprobadas(): Promise<Set<string>> {
  if (aprobadasCache && Date.now() - aprobadasCache.ts < 10 * 60_000) return aprobadasCache.nombres
  const nombres = new Set((await listarPlantillasWhatsapp()).filter(p => p.estado === 'APPROVED').map(p => p.nombre))
  aprobadasCache = { ts: Date.now(), nombres }
  return nombres
}

/**
 * Crea en Meta las plantillas del catálogo que aún no existan (envío a revisión).
 * Idempotente: salta las que ya están (cualquier estado). Devuelve el detalle por
 * plantilla. `allow_category_change` deja que Meta recategorice (p. ej. UTILITY→
 * MARKETING) en vez de rechazar.
 */
export async function crearPlantillasFaltantes(): Promise<{ nombre: string; resultado: string }[]> {
  const token = process.env.WHATSAPP_TOKEN
  const waba = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID
  if (!token || !waba) return Object.keys(PLANTILLAS_WA).map(n => ({ nombre: n, resultado: 'WhatsApp/WABA no configurado' }))
  const existentes = new Set((await listarPlantillasWhatsapp()).map(p => p.nombre))
  const out: { nombre: string; resultado: string }[] = []
  for (const p of Object.values(PLANTILLAS_WA)) {
    if (existentes.has(p.nombre)) { out.push({ nombre: p.nombre, resultado: 'ya existe (se salta)' }); continue }
    const body: Record<string, unknown> = { type: 'BODY', text: p.texto }
    if (p.ejemplos.length) body.example = { body_text: [p.ejemplos] }
    try {
      const res = await fetch(`${GRAPH}/${version()}/${waba}/message_templates`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: p.nombre, language: IDIOMA_PLANTILLAS, category: p.categoria, allow_category_change: true, components: [body] }),
      })
      const j = await res.json().catch(() => ({}))
      out.push({ nombre: p.nombre, resultado: res.ok ? `creada (id ${j.id || '?'}, estado ${j.status || 'PENDING'})` : `ERROR: ${j?.error?.error_user_msg || j?.error?.message || res.status}` })
    } catch (e) {
      out.push({ nombre: p.nombre, resultado: `ERROR: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
  return out
}

/**
 * Números de WhatsApp del EQUIPO admin (dueño + socios) que reciben los avisos
 * del bot y pueden confirmar/rechazar/responder. `ADMIN_WHATSAPP` acepta VARIOS
 * números separados por coma (el Cloud API de Meta NO permite escribir a grupos,
 * así que la "grupalidad" se logra avisando a todos los admins a la vez; las
 * resoluciones son atómicas → el primero que actúa gana y el resto ve el acuse).
 */
export function adminsWhatsapp(): string[] {
  const raw = process.env.ADMIN_WHATSAPP || '56978640811'
  const nums = raw.split(/[,;\s]+/).map(n => n.replace(/\D/g, '')).filter(n => n.length >= 9)
  return [...new Set(nums.length ? nums : ['56978640811'])]
}

/** Primer número admin (compatibilidad con el uso histórico de un solo admin). */
export function adminWhatsapp(): string {
  return adminsWhatsapp()[0]
}

/** ¿El número pertenece al equipo admin del env? (chequeo sync, solo ADMIN_WHATSAPP). */
export function esAdminWhatsapp(num: string): boolean {
  return adminsWhatsapp().includes((num || '').replace(/\D/g, ''))
}

/**
 * Destinatarios de los avisos/botones del sistema = ADMIN_WHATSAPP (env) +
 * usuarios ACTIVOS con celular y avisos_whatsapp=TRUE (Configuración → Usuarios).
 * Cache 60s: un cambio en la tabla aplica al minuto sin pegarle a la DB en cada aviso.
 */
let avisosCache: { ts: number; nums: string[] } | null = null
export async function destinatariosAvisos(): Promise<string[]> {
  if (avisosCache && Date.now() - avisosCache.ts < 60_000) return avisosCache.nums
  const nums = new Set(adminsWhatsapp())
  try {
    const { getSheetData } = await import('./datastore')
    for (const u of await getSheetData('usuarios')) {
      if (u.activo !== 'TRUE' || u.avisos_whatsapp !== 'TRUE') continue
      const t = (u.telefono || '').replace(/\D/g, '').slice(-9)
      if (t.length === 9) nums.add(`56${t}`)
    }
  } catch (e) { console.warn('[whatsapp] no se pudo leer usuarios para los avisos (sigue solo el env):', e) }
  avisosCache = { ts: Date.now(), nums: [...nums] }
  return avisosCache.nums
}

/** ¿El número puede recibir/resolver avisos del sistema? (env + usuarios con avisos ON). */
export async function esDestinatarioAvisos(num: string): Promise<boolean> {
  return (await destinatariosAvisos()).includes((num || '').replace(/\D/g, ''))
}

/**
 * Envía un texto a TODO el equipo (env + usuarios con avisos WhatsApp activados;
 * best-effort por número: si uno falla, los demás igual reciben). Si alguien tiene
 * la ventana de 24h cerrada, reintenta con la plantilla `aviso_operativo`
 * (aprobada) — así los avisos del sistema nunca se pierden.
 */
export async function avisarAdminsWhatsapp(body: string): Promise<EnvioResult[]> {
  const out: EnvioResult[] = []
  for (const num of await destinatariosAvisos()) {
    try {
      let r = await enviarTextoWhatsapp(num, body)
      if (!r.ok && r.fuera_de_ventana && (await plantillasAprobadas()).has('aviso_operativo')) {
        r = await enviarPlantillaWhatsapp(num, 'aviso_operativo', [body.slice(0, 500)])
      }
      out.push(r)
    } catch (e) { out.push({ ok: false, error: e instanceof Error ? e.message : String(e) }) }
  }
  return out
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
