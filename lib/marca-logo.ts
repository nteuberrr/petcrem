import sharp from 'sharp'
import { getFromR2, keyFromPublicUrl } from './cloudflare-r2'
import { LOGO_URL } from './email-layout'
import type { ImagenBanco } from './mailing-images'

/**
 * Marca de agua del LOGO de Alma Animal sobre las imágenes que publicamos.
 *
 * Los logos viven en el BANCO (grupo "marca", subidos por el equipo en distintos
 * colores). El modelo de imagen NO dibuja el logo (sale deforme); acá elegimos la
 * variante que mejor CONTRASTA con la esquina donde va y la pegamos con sharp
 * (nítida, proporción intacta). Si el banco no tuviera ninguna, caemos al logo
 * OFICIAL (LOGO_URL) → SIEMPRE hay logo.
 *
 * `import type` de ImagenBanco (solo tipo) para NO crear ciclo en runtime con
 * mailing-images (que sí importa este módulo).
 */

interface LogoSrc { url: string; key?: string }

// Cache de bytes de cada logo por URL (cambian rara vez).
const cacheBytes = new Map<string, Buffer>()

/**
 * ¿Esta imagen del banco es un logo/sello de marca? SOLO por grupo "marca" (señal
 * fiable). No por nombre: muchas piezas (portadas) mencionan "logo" en su descripción
 * y se colarían como logo. Si el grupo "marca" estuviera vacío, aplicarLogoMarca cae
 * al logo OFICIAL (LOGO_URL).
 */
export function esLogo(i: ImagenBanco): boolean {
  return !!i.url && (i.grupo || '').toLowerCase() === 'marca'
}

async function bytesDe(src: LogoSrc): Promise<Buffer | null> {
  const cached = cacheBytes.get(src.url)
  if (cached) return cached
  const key = src.key || keyFromPublicUrl(src.url) || ''
  let buf = key ? await getFromR2(key) : null
  if (!buf && src.url) {
    try { const r = await fetch(src.url); if (r.ok) buf = Buffer.from(await r.arrayBuffer()) } catch { /* sin bytes */ }
  }
  if (buf) cacheBytes.set(src.url, buf)
  return buf
}

function luminancia(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

/** Luminancia media de la esquina inferior derecha de la base (0=oscuro, 1=claro). */
async function lumEsquina(base: Buffer): Promise<number> {
  try {
    const meta = await sharp(base).metadata()
    const W = meta.width || 0, H = meta.height || 0
    if (!W || !H) return 0.5
    const w = Math.max(1, Math.round(W * 0.3)), h = Math.max(1, Math.round(H * 0.22))
    // OJO: sharp .stats() IGNORA el .extract() del pipeline (mide el original). Hay
    // que materializar el recorte con raw().toBuffer() y promediar a mano.
    const { data, info } = await sharp(base)
      .extract({ left: Math.max(0, W - w), top: Math.max(0, H - h), width: w, height: h })
      .raw().toBuffer({ resolveWithObject: true })
    const ch = info.channels
    let sr = 0, sg = 0, sb = 0, n = 0
    for (let i = 0; i + ch <= data.length; i += ch) { sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; n++ }
    return n > 0 ? luminancia(sr / n, sg / n, sb / n) : 0.5
  } catch { return 0.5 }
}

/**
 * Luminancia "de tinta" del logo: promedio SOLO sobre píxeles OPACOS. Es clave que
 * ignore la transparencia — un PNG de logo blanco tiene casi todo transparente, y
 * el color dominante lo leería como oscuro, eligiendo mal la variante.
 */
async function lumLogo(buf: Buffer): Promise<number> {
  try {
    const { data, info } = await sharp(buf).resize({ width: 64, height: 64, fit: 'inside' })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const ch = info.channels
    let sum = 0, n = 0
    for (let i = 0; i + ch <= data.length; i += ch) {
      const a = ch >= 4 ? data[i + 3] : 255
      if (a < 128) continue // ignora transparente / semitransparente
      sum += luminancia(data[i], data[i + 1], data[i + 2])
      n++
    }
    return n > 0 ? sum / n : 0.5
  } catch { return 0.5 }
}

interface LogoElegido { src: LogoSrc; bytes: Buffer }

/** Elige la variante de logo que mejor contrasta con la esquina (o `preferUrl`). */
async function elegirLogo(base: Buffer, srcs: LogoSrc[], preferUrl?: string): Promise<LogoElegido | null> {
  const conBytes: LogoElegido[] = []
  for (const s of srcs) {
    const b = await bytesDe(s)
    if (b) conBytes.push({ src: s, bytes: b })
  }
  if (conBytes.length === 0) return null
  if (preferUrl) {
    const pick = conBytes.find(c => c.src.url === preferUrl)
    if (pick) return pick
  }
  if (conBytes.length === 1) return conBytes[0]
  const cornerLum = await lumEsquina(base)
  let best = conBytes[0], bestScore = -1
  for (const c of conBytes) {
    const score = Math.abs(cornerLum - await lumLogo(c.bytes)) // más contraste = mejor (legible)
    if (score > bestScore) { bestScore = score; best = c }
  }
  return best
}

/** Pega el logo abajo a la derecha de la imagen base; devuelve un buffer nuevo. */
async function componerLogo(base: Buffer, logoBytes: Buffer, escala: number): Promise<Buffer> {
  const meta = await sharp(base).metadata()
  const W = meta.width || 1024, H = meta.height || 1024
  const targetW = Math.max(96, Math.round(W * escala))
  const logo = await sharp(logoBytes).resize({ width: targetW, withoutEnlargement: true }).png().toBuffer()
  const lm = await sharp(logo).metadata()
  const margin = Math.round(W * 0.04)
  const left = Math.max(0, W - (lm.width || targetW) - margin)
  const top = Math.max(0, H - (lm.height || targetW) - margin)
  return sharp(base).composite([{ input: logo, left, top }]).toBuffer()
}

/**
 * Aplica el logo de marca (mejor variante por contraste del banco, o `preferUrl`,
 * o el logo OFICIAL como fallback) abajo a la derecha. Best-effort: ante cualquier
 * error devuelve la base intacta.
 */
export async function aplicarLogoMarca(
  base: Buffer,
  logos: ImagenBanco[],
  opts: { preferUrl?: string; escala?: number } = {},
): Promise<{ buffer: Buffer; aplicado: boolean }> {
  try {
    const srcs: LogoSrc[] = logos.filter(esLogo).map(i => ({ url: i.url, key: i.key }))
    // Fallback: si el equipo no subió variantes al grupo "marca", usamos el logo OFICIAL.
    if (srcs.length === 0 && LOGO_URL) srcs.push({ url: LOGO_URL })
    if (srcs.length === 0) return { buffer: base, aplicado: false }
    const elegido = await elegirLogo(base, srcs, opts.preferUrl)
    if (!elegido) return { buffer: base, aplicado: false }
    const out = await componerLogo(base, elegido.bytes, opts.escala ?? 0.18)
    return { buffer: out, aplicado: true }
  } catch {
    return { buffer: base, aplicado: false }
  }
}
