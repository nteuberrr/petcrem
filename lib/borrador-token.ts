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
 *
 * ── FORMATO COMPACTO (v2) ───────────────────────────────────────────────────
 * El token viaja dentro de un WhatsApp que lee una persona en duelo, y el
 * formato viejo —JSON en base64 + firma completa— daba ~105 caracteres que en
 * el teléfono se veían como tres renglones de ruido. El nuevo es
 * `<id en base36>.<vencimiento en base36>.<firma de 16 caracteres>`: unos 25.
 * Con la ruta corta /f/<token>, el link entero baja de ~150 a ~50 caracteres.
 *
 * La firma se recorta a 16 caracteres base64url = **96 bits**. Es de sobra para
 * lo que protege: adivinarla no da acceso a datos —el link solo deja COMPLETAR
 * un borrador, nunca leerlo ni generar el código— y un intento por nanosegundo
 * durante mil años ni se acerca.
 *
 * `verifyBorradorToken` sigue aceptando el formato viejo: hay links de hasta 30
 * días circulando en los WhatsApp de la gente y romperlos sería mandarlos a un
 * error sin explicación.
 */

const DEFAULT_TTL_SECONDS = 30 * 24 * 3600
/** Caracteres de firma del formato compacto (96 bits). */
const LARGO_FIRMA = 16

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
  const cid = String(clienteId)
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  // base36 en minúsculas: la mitad de caracteres que el decimal y sin símbolos
  // que WhatsApp pueda comerse al autolinkear.
  const cuerpo = `${Number(cid).toString(36)}.${exp.toString(36)}`
  return `${cuerpo}.${sign(cuerpo).slice(0, LARGO_FIRMA)}`
}

/**
 * El link COMPLETO que se le manda al tutor, en su forma corta. Única fuente:
 * si alguien vuelve a armarlo a mano con `/registro-mascota?ficha=`, el mensaje
 * queda con el link largo otra vez.
 *
 * `base` es opcional y por defecto es el dominio de la MARCA (no el de Vercel):
 * el link lo abre alguien que acaba de perder a su mascota, y desconfiar de un
 * «petcrem.vercel.app» es lo sano.
 */
export function linkBorrador(clienteId: string | number, base?: string): string {
  const raiz = (base || process.env.PUBLIC_BASE_URL || 'https://www.crematorioalmaanimal.cl').replace(/\/$/, '')
  return `${raiz}/f/${createBorradorToken(String(clienteId))}`
}

export interface VerifyBorradorResult {
  ok: boolean
  clienteId?: string
  error?: 'malformed' | 'invalid_signature' | 'expired' | 'bad_payload'
}

export function verifyBorradorToken(token: string): VerifyBorradorResult {
  if (!token || !token.includes('.')) return { ok: false, error: 'malformed' }
  const partes = token.split('.')
  // Formato compacto (v2): id.vencimiento.firma
  if (partes.length === 3) return verificarCompacto(partes)
  const [payloadB64, sig] = partes
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

/** Verifica el formato compacto `<id36>.<exp36>.<firma>`. */
function verificarCompacto([cid36, exp36, sig]: string[]): VerifyBorradorResult {
  if (!cid36 || !exp36 || !sig) return { ok: false, error: 'malformed' }
  const esperada = sign(`${cid36}.${exp36}`).slice(0, LARGO_FIRMA)
  const a = Buffer.from(sig)
  const b = Buffer.from(esperada)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, error: 'invalid_signature' }
  const cid = parseInt(cid36, 36)
  const exp = parseInt(exp36, 36)
  if (!Number.isFinite(cid) || cid <= 0 || !Number.isFinite(exp)) return { ok: false, error: 'bad_payload' }
  if (exp < Math.floor(Date.now() / 1000)) return { ok: false, error: 'expired' }
  return { ok: true, clienteId: String(cid) }
}
