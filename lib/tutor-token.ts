import crypto from 'crypto'

/**
 * Token HMAC firmado para las acciones de auto-atención del TUTOR desde el correo
 * de registro (sin sesión): subir la foto de la mascota o solicitar el video del
 * proceso. Reemplaza al "código" de la mascota, que era secuencial y adivinable.
 * Solo quien recibió el correo tiene el token de ESA ficha y ESA acción.
 *
 * Firmado con NEXTAUTH_SECRET. TTL 24 horas: los links de foto/video del correo
 * valen solo un día (decisión del cliente).
 */

export type AccionTutor = 'subir_foto' | 'solicitar_video'

const DEFAULT_TTL_SECONDS = 24 * 3600 // 24 horas

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

export function createTutorToken(clienteId: string, accion: AccionTutor, ttlSeconds: number = DEFAULT_TTL_SECONDS): string {
  const payload: TutorTokenPayload = {
    cid: String(clienteId),
    t: accion,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  }
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  return `${payloadB64}.${sign(payloadB64)}`
}

export interface VerifyTutorResult {
  ok: boolean
  clienteId?: string
  error?: 'malformed' | 'invalid_signature' | 'expired' | 'bad_payload'
}

/** Verifica firma + expiración + que el token sea de la acción esperada. */
export function verifyTutorToken(token: string, accion: AccionTutor): VerifyTutorResult {
  if (!token || !token.includes('.')) return { ok: false, error: 'malformed' }
  const [payloadB64, sig] = token.split('.')
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
