import crypto from 'crypto'

/**
 * Token HMAC firmado para las acciones de auto-atención del TUTOR desde el correo
 * de registro (sin sesión): subir la foto de la mascota o solicitar el video del
 * proceso. Reemplaza al "código" de la mascota, que era secuencial y adivinable.
 * Solo quien recibió el correo tiene el token de ESA ficha y ESA acción.
 *
 * Firmado con NEXTAUTH_SECRET.
 *
 * ── TTL: 15 DÍAS, no 48 horas ───────────────────────────────────────────────
 * Eran 48 h (decisión del cliente 2026-07-13, subiéndolo desde 24) y ese plazo
 * es estructuralmente demasiado corto: el link se manda al REGISTRAR la ficha y
 * el certificado se emite varios días hábiles después (más aún durante una
 * ventana de alta demanda, ver lib/plazo-entrega), así que el tutor que se
 * demora dos días en elegir la foto se encuentra con un link muerto. El propio
 * guion del bot lo da por hecho — «si el link no le funciona: es lo más común» —
 * y cada caso termina en un humano reenviándolo a mano. 15 días cubren el
 * servicio completo con margen. El link no expone datos: solo permite SUBIR una
 * foto a esa ficha.
 *
 * ── FORMATO COMPACTO (v2) ───────────────────────────────────────────────────
 * `<id36>.<acción>.<vencimiento36>.<firma de 16 car>` — unos 30 caracteres
 * contra los ~110 del formato viejo (JSON en base64 + firma entera). Importa
 * porque estos links ahora viajan también por WhatsApp, y sobre todo porque un
 * botón de URL de Meta solo admite variar un SUFIJO corto al final de una base
 * fija. `verifyTutorToken` sigue aceptando el formato viejo: hay correos con
 * links vivos dando vueltas.
 */

export type AccionTutor = 'subir_foto' | 'solicitar_video' | 'subir_foto_cuadro' | 'ver_certificado'

const DEFAULT_TTL_SECONDS = 15 * 24 * 3600 // 15 días
/** El certificado es del tutor para siempre; su link no tiene por qué vencer pronto. */
const TTL_CERTIFICADO = 365 * 24 * 3600
/** Caracteres de firma del formato compacto (96 bits). */
const LARGO_FIRMA = 16

/** Una letra por acción, para que el token quede corto. */
const COD_ACCION: Record<AccionTutor, string> = {
  subir_foto: 'f',
  subir_foto_cuadro: 'c',
  solicitar_video: 'v',
  ver_certificado: 'x',
}
const ACCION_DE_COD: Record<string, AccionTutor> = Object.fromEntries(
  Object.entries(COD_ACCION).map(([k, v]) => [v, k as AccionTutor]),
) as Record<string, AccionTutor>

interface TutorTokenPayload {
  cid: string // cliente id
  t: AccionTutor
  exp: number // unix seconds
}

function getSecret(): string {
  const s = process.env.NEXTAUTH_SECRET
  if (!s) throw new Error('NEXTAUTH_SECRET no configurada')
  return s
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64urlDecode(s: string): Buffer {
  s = s.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  return Buffer.from(s, 'base64')
}
function sign(data: string): string {
  return b64url(crypto.createHmac('sha256', getSecret()).update(data).digest())
}

export function createTutorToken(clienteId: string, accion: AccionTutor, ttlSeconds?: number): string {
  const ttl = ttlSeconds ?? (accion === 'ver_certificado' ? TTL_CERTIFICADO : DEFAULT_TTL_SECONDS)
  const exp = Math.floor(Date.now() / 1000) + ttl
  const cuerpo = `${Number(clienteId).toString(36)}.${COD_ACCION[accion]}.${exp.toString(36)}`
  return `${cuerpo}.${sign(cuerpo).slice(0, LARGO_FIRMA)}`
}

/**
 * Qué acción pide un token, SIN validarlo. Lo usa la ruta corta para saber a
 * dónde redirigir; la verificación de verdad la hace el destino.
 */
export function accionDeToken(token: string): AccionTutor | null {
  const partes = (token || '').split('.')
  if (partes.length !== 4) return null
  return ACCION_DE_COD[partes[1]] ?? null
}

export interface VerifyTutorResult {
  ok: boolean
  clienteId?: string
  error?: 'malformed' | 'invalid_signature' | 'expired' | 'bad_payload'
}

/** Verifica firma + expiración + que el token sea de la acción esperada. */
export function verifyTutorToken(token: string, accion: AccionTutor): VerifyTutorResult {
  if (!token || !token.includes('.')) return { ok: false, error: 'malformed' }
  const partes = token.split('.')
  if (partes.length === 4) return verificarCompacto(partes, accion)
  const [payloadB64, sig] = partes
  if (!payloadB64 || !sig) return { ok: false, error: 'malformed' }
  const expected = sign(payloadB64)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, error: 'invalid_signature' }
  let payload: TutorTokenPayload
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'))
  } catch {
    return { ok: false, error: 'bad_payload' }
  }
  if (payload.t !== accion || !payload.cid) return { ok: false, error: 'bad_payload' }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return { ok: false, error: 'expired' }
  return { ok: true, clienteId: payload.cid }
}

/** Verifica el formato compacto `<id36>.<acción>.<exp36>.<firma>`. */
function verificarCompacto([cid36, cod, exp36, sig]: string[], accion: AccionTutor): VerifyTutorResult {
  if (!cid36 || !cod || !exp36 || !sig) return { ok: false, error: 'malformed' }
  const esperada = sign(`${cid36}.${cod}.${exp36}`).slice(0, LARGO_FIRMA)
  const a = Buffer.from(sig)
  const b = Buffer.from(esperada)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, error: 'invalid_signature' }
  // La acción se compara DESPUÉS de la firma: así un token válido para otra cosa
  // no se distingue de uno falso por el mensaje de error.
  if (ACCION_DE_COD[cod] !== accion) return { ok: false, error: 'bad_payload' }
  const cid = parseInt(cid36, 36)
  const exp = parseInt(exp36, 36)
  if (!Number.isFinite(cid) || cid <= 0 || !Number.isFinite(exp)) return { ok: false, error: 'bad_payload' }
  if (exp < Math.floor(Date.now() / 1000)) return { ok: false, error: 'expired' }
  return { ok: true, clienteId: String(cid) }
}
