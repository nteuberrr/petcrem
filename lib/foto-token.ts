import crypto from 'crypto'

/**
 * Token HMAC firmado para que el TUTOR suba la foto de su mascota desde el link
 * del correo de registro (sin sesión). Reemplaza al "código" de la mascota, que
 * era secuencial y adivinable (permitía enumerar nombres y subir imágenes a
 * fichas ajenas). Solo quien recibió el correo tiene el token de ESA ficha.
 *
 * Firmado con NEXTAUTH_SECRET. TTL amplio (90 días): la foto se usa en el
 * certificado de cremación y el tutor puede tardar en subirla.
 */

const DEFAULT_TTL_SECONDS = 90 * 24 * 3600

interface FotoTokenPayload {
  cid: string // cliente id
  t: 'subir_foto'
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

export function createFotoToken(clienteId: string, ttlSeconds: number = DEFAULT_TTL_SECONDS): string {
  const payload: FotoTokenPayload = {
    cid: String(clienteId),
    t: 'subir_foto',
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  }
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  return `${payloadB64}.${sign(payloadB64)}`
}

export interface VerifyFotoResult {
  ok: boolean
  clienteId?: string
  error?: 'malformed' | 'invalid_signature' | 'expired' | 'bad_payload'
}

export function verifyFotoToken(token: string): VerifyFotoResult {
  if (!token || !token.includes('.')) return { ok: false, error: 'malformed' }
  const [payloadB64, sig] = token.split('.')
  if (!payloadB64 || !sig) return { ok: false, error: 'malformed' }
  const expected = sign(payloadB64)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, error: 'invalid_signature' }
  let payload: FotoTokenPayload
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'))
  } catch {
    return { ok: false, error: 'bad_payload' }
  }
  if (payload.t !== 'subir_foto' || !payload.cid) return { ok: false, error: 'bad_payload' }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return { ok: false, error: 'expired' }
  return { ok: true, clienteId: payload.cid }
}
