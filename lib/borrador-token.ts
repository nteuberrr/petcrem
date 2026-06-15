import crypto from 'crypto'

/**
 * Token HMAC firmado para que el TUTOR complete su ficha borrador desde un link
 * (sin sesión). Se manda en el WhatsApp de "retiro confirmado".
 *
 * Importante: completar la ficha por este link SOLO enriquece el borrador — NO
 * genera código ni dispara el correo de bienvenida. El "ingreso oficial" (código
 * + correo) lo hace el operador al "Registrar ficha" en /clientes.
 *
 * Firmado con NEXTAUTH_SECRET. TTL por defecto 30 días (margen amplio; el link
 * solo permite editar un borrador, no datos sensibles, y el endpoint rechaza si
 * la ficha ya dejó de ser borrador).
 */

const DEFAULT_TTL_SECONDS = 30 * 24 * 3600

interface BorradorTokenPayload {
  cid: string // cliente (borrador) id
  t: 'completar_ficha'
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

export function createBorradorToken(clienteId: string, ttlSeconds: number = DEFAULT_TTL_SECONDS): string {
  const payload: BorradorTokenPayload = {
    cid: String(clienteId),
    t: 'completar_ficha',
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  }
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  return `${payloadB64}.${sign(payloadB64)}`
}

export interface VerifyBorradorResult {
  ok: boolean
  clienteId?: string
  error?: 'malformed' | 'invalid_signature' | 'expired' | 'bad_payload'
}

export function verifyBorradorToken(token: string): VerifyBorradorResult {
  if (!token || !token.includes('.')) return { ok: false, error: 'malformed' }
  const [payloadB64, sig] = token.split('.')
  if (!payloadB64 || !sig) return { ok: false, error: 'malformed' }
  const expected = sign(payloadB64)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, error: 'invalid_signature' }
  let payload: BorradorTokenPayload
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'))
  } catch {
    return { ok: false, error: 'bad_payload' }
  }
  if (payload.t !== 'completar_ficha' || !payload.cid) return { ok: false, error: 'bad_payload' }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return { ok: false, error: 'expired' }
  return { ok: true, clienteId: payload.cid }
}
