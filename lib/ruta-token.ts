import crypto from 'crypto'

/**
 * HOJA DE RUTA COMPARTIBLE — token HMAC firmado con el que un repartidor externo
 * abre la ruta de despacho sin tener cuenta en el sistema.
 *
 * El link se genera desde Operaciones → Despachos ("Compartir con el delivery")
 * y se le pasa por WhatsApp. Quien lo tenga ve las paradas de ESA ruta —los
 * mismos datos de la etiqueta que imprimimos: código, mascota, tutor, dirección
 * y teléfono— y puede marcar cada entrega. No da acceso a nada más: el token
 * lleva un único `did` y el endpoint público solo sabe leer esa ruta y marcar
 * entregas suyas.
 *
 * TTL corto (3 días por defecto): una ruta se hace en el día, y un link que
 * anda circulando por WhatsApp no debería seguir vivo un mes después.
 *
 * Mismo esquema que [lib/borrador-token.ts](borrador-token.ts) y los tokens de
 * eutanasia: firmado con NEXTAUTH_SECRET.
 *
 * ⚠️ El secret de local NO es el de producción: un link firmado en local lo
 * rechaza prod (y sale con localhost). Generarlo siempre desde el sistema en
 * producción.
 */

const DEFAULT_TTL_SECONDS = 3 * 24 * 3600

interface RutaTokenPayload {
  did: string // despacho id
  t: 'hoja_ruta'
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

export function crearRutaToken(despachoId: string, ttlSeconds: number = DEFAULT_TTL_SECONDS): string {
  const payload: RutaTokenPayload = {
    did: String(despachoId),
    t: 'hoja_ruta',
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  }
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  return `${payloadB64}.${sign(payloadB64)}`
}

export interface VerifyRutaResult {
  ok: boolean
  despachoId?: string
  error?: 'malformed' | 'invalid_signature' | 'expired' | 'bad_payload'
}

export function verificarRutaToken(token: string): VerifyRutaResult {
  if (!token || !token.includes('.')) return { ok: false, error: 'malformed' }
  const [payloadB64, sig] = token.split('.')
  if (!payloadB64 || !sig) return { ok: false, error: 'malformed' }
  const expected = sign(payloadB64)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, error: 'invalid_signature' }
  let payload: RutaTokenPayload
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'))
  } catch {
    return { ok: false, error: 'bad_payload' }
  }
  if (payload.t !== 'hoja_ruta' || !payload.did) return { ok: false, error: 'bad_payload' }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return { ok: false, error: 'expired' }
  return { ok: true, despachoId: payload.did }
}
