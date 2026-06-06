import crypto from 'crypto'

/**
 * Tokens HMAC firmados para acciones que un veterinario realiza desde un
 * link que recibe por mail, SIN sesión en el sistema.
 *
 * Caso de uso:
 * 1. Admin envía cotización al vet → URL `/eutanasia/aceptar/<token>` con
 *    accion='aceptar', cotizacion_id, vet_id, exp.
 * 2. Vet hace clic → backend verifica firma + expiración → marca aceptada.
 * 3. Backend manda un nuevo mail al vet con URL `/eutanasia/confirmar/<token>`
 *    con accion='confirmar' y un token NUEVO (no reusamos el de aceptar).
 *
 * El token contiene los datos mínimos necesarios (no datos sensibles), está
 * firmado con NEXTAUTH_SECRET y expira en 72h por default.
 */

const DEFAULT_TTL_SECONDS = 72 * 3600 // 72h

export type AccionToken = 'aceptar' | 'confirmar' | 'realizado' | 'datos_pago'

export interface TokenPayload {
  cotizacion_id: string
  vet_id: string
  accion: AccionToken
  /** Unix seconds. */
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
  const h = crypto.createHmac('sha256', getSecret()).update(data).digest()
  return b64url(h)
}

/**
 * Crea un token firmado. Formato: `<payload_b64url>.<signature_b64url>`
 * donde payload es JSON.stringify(TokenPayload).
 *
 * Para acciones ligadas a una cotización, pasa cotizacion_id; para acciones
 * generales por vet (como 'datos_pago'), pasa '' o usa createVetToken.
 */
export function createToken(
  cotizacion_id: string,
  vet_id: string,
  accion: AccionToken,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const payload: TokenPayload = { cotizacion_id, vet_id, accion, exp }
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  const sig = sign(payloadB64)
  return `${payloadB64}.${sig}`
}

/**
 * Helper para acciones a nivel vet (no ligadas a una cotización).
 * TTL default: 90 días, así el vet puede usar el link del mail de bienvenida
 * incluso si tarda algunos días en completar sus datos bancarios.
 */
export function createVetToken(
  vet_id: string,
  accion: AccionToken,
  ttlSeconds: number = 90 * 24 * 3600,
): string {
  return createToken('', vet_id, accion, ttlSeconds)
}

export interface VerifyResult {
  ok: boolean
  payload?: TokenPayload
  error?: 'malformed' | 'invalid_signature' | 'expired' | 'bad_payload'
}

/** Verifica firma y expiración. */
export function verifyToken(token: string): VerifyResult {
  if (!token || !token.includes('.')) return { ok: false, error: 'malformed' }
  const [payloadB64, sig] = token.split('.')
  if (!payloadB64 || !sig) return { ok: false, error: 'malformed' }
  const expected = sign(payloadB64)
  // Comparación constante para no filtrar por timing
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: 'invalid_signature' }
  }
  let payload: TokenPayload
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'))
  } catch {
    return { ok: false, error: 'bad_payload' }
  }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, error: 'expired' }
  }
  if (!payload.vet_id || !['aceptar', 'confirmar', 'realizado', 'datos_pago'].includes(payload.accion)) {
    return { ok: false, error: 'bad_payload' }
  }
  // cotizacion_id es opcional para 'datos_pago' (no aplica a una cotización
  // específica). Para las otras acciones sigue siendo obligatorio.
  if (payload.accion !== 'datos_pago' && !payload.cotizacion_id) {
    return { ok: false, error: 'bad_payload' }
  }
  return { ok: true, payload }
}
