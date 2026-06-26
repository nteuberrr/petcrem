import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'

/**
 * Base compartida para los PDF de marca (catálogo, dossier corporativo): formato
 * CARTA (Letter, imprimible), paleta de Alma Animal y la tipografía REAL de marca
 * (Inter, la misma de los correos y gráficos) embebida con fontkit. Centraliza esto
 * para que todos los documentos salgan con la misma calidad y consistencia.
 */

// Carta (Letter) 8.5 × 11" a 72 dpi → imprimible sin reescalado.
export const LETTER = { W: 612, H: 792 }

export const C = {
  navy: rgb(0x14 / 255, 0x3C / 255, 0x64 / 255),
  navyDeep: rgb(0x0f / 255, 0x2e / 255, 0x4d / 255),
  navySoft: rgb(0x2A / 255, 0x6D / 255, 0xB0 / 255),
  gold: rgb(0xF2 / 255, 0xB8 / 255, 0x4B / 255),
  goldDeep: rgb(0xC9 / 255, 0x95 / 255, 0x2f / 255),
  cream: rgb(0xFB / 255, 0xF8 / 255, 0xF3 / 255),
  ink: rgb(0x1f / 255, 0x29 / 255, 0x37 / 255),
  muted: rgb(0x5b / 255, 0x66 / 255, 0x74 / 255),
  white: rgb(1, 1, 1),
  line: rgb(0xe4 / 255, 0xdf / 255, 0xd6 / 255),
  lineSoft: rgb(0xef / 255, 0xeb / 255, 0xe3 / 255),
  zebra: rgb(0xF8 / 255, 0xF4 / 255, 0xED / 255),
}

export interface BrandFonts {
  regular: PDFFont
  semibold: PDFFont
  bold: PDFFont
}

const R2 = (process.env.R2_PUBLIC_URL || 'https://pub-9ca489d9f825495b83375f6e526f354e.r2.dev').replace(/\/$/, '')
const cache = new Map<string, Uint8Array>()

async function fontBytes(file: string): Promise<Uint8Array> {
  const hit = cache.get(file)
  if (hit) return hit
  const r = await fetch(`${R2}/brand/fonts/${file}`)
  if (!r.ok) throw new Error(`no se pudo bajar la fuente ${file} (${r.status})`)
  const buf = new Uint8Array(await r.arrayBuffer())
  cache.set(file, buf)
  return buf
}

/**
 * Embebe la familia Inter (regular / semibold / bold) en el documento. Si por algún
 * motivo no se pueden bajar las fuentes, cae a Helvetica para no romper la generación.
 */
export async function embedBrandFonts(doc: PDFDocument): Promise<BrandFonts> {
  try {
    doc.registerFontkit(fontkit)
    const [r, sb, b] = await Promise.all([
      fontBytes('Inter-Regular.woff'),
      fontBytes('Inter-SemiBold.woff'),
      fontBytes('Inter-Bold.woff'),
    ])
    return {
      regular: await doc.embedFont(r, { subset: true }),
      semibold: await doc.embedFont(sb, { subset: true }),
      bold: await doc.embedFont(b, { subset: true }),
    }
  } catch (e) {
    console.warn('[pdf-brand] fuentes de marca no disponibles, uso Helvetica:', e)
    const reg = await doc.embedFont(StandardFonts.Helvetica)
    const bold = await doc.embedFont(StandardFonts.HelveticaBold)
    return { regular: reg, semibold: bold, bold }
  }
}

/** Parte un texto en líneas que entran en maxW (respeta los saltos \n del texto). */
export function wrapText(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = []
  for (const para of String(text ?? '').split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    if (words.length === 0) { out.push(''); continue }
    let cur = ''
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w
      if (font.widthOfTextAtSize(test, size) > maxW && cur) { out.push(cur); cur = w }
      else cur = test
    }
    if (cur) out.push(cur)
  }
  return out
}

/** Recorta a una línea con "…" si no entra en maxW. */
export function fitText(text: string, font: PDFFont, size: number, maxW: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxW) return text
  let t = text
  while (t.length > 1 && font.widthOfTextAtSize(t + '…', size) > maxW) t = t.slice(0, -1)
  return t + '…'
}
