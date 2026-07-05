import crypto from 'crypto'

/**
 * Token HMAC firmado para que un CLIENTE (tutor) confirme, desde el correo, que
 * hizo la transferencia de un cobro (adicional o diferencia de peso). SIN sesión:
 * el token ES la autenticación. Firma con NEXTAUTH_SECRET. TTL largo (30 días)
 * porque el cliente puede pagar días después; el endpoint es idempotente.
 */

const DEFAULT_TTL_SECONDS = 30 * 24 * 3600 // 30 días

interface CobroTokenPayload {
  cobro_id: string
  exp: number
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

export function createCobroToken(cobroId: string, ttlSeconds = DEFAULT_TTL_SECONDS): string {
  const payload: CobroTokenPayload = { cobro_id: String(cobroId), exp: Math.floor(Date.now() / 1000) + ttlSeconds }
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  return `${payloadB64}.${sign(payloadB64)}`
}

export interface CobroVerify { ok: boolean; cobro_id?: string; error?: 'malformed' | 'invalid_signature' | 'expired' | 'bad_payload' }

export function verifyCobroToken(token: string): CobroVerify {
  if (!token || !token.includes('.')) return { ok: false, error: 'malformed' }
  const [payloadB64, sig] = token.split('.')
  if (!payloadB64 || !sig) return { ok: false, error: 'malformed' }
  const a = Buffer.from(sig)
  const b = Buffer.from(sign(payloadB64))
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, error: 'invalid_signature' }
  let payload: CobroTokenPayload
  try { payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8')) } catch { return { ok: false, error: 'bad_payload' } }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return { ok: false, error: 'expired' }
  if (!payload.cobro_id) return { ok: false, error: 'bad_payload' }
  return { ok: true, cobro_id: String(payload.cobro_id) }
}
