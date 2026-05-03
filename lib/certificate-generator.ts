import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import {
  PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb,
  pushGraphicsState, popGraphicsState, rectangle, clip, endPath,
} from 'pdf-lib'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

export interface CertificadoData {
  nombre_mascota: string
  especie: string
  fecha_cremacion_raw: string
  nombre_tutor: string
  codigo: string
  /** Bytes opcionales de la foto de la mascota (jpg/png). Si no, se genera versión "sin foto". */
  foto_bytes?: Uint8Array
  /** Forzar versión sin foto aunque haya bytes presentes */
  sin_foto?: boolean
}

// =============================================================================
// PALETA OFICIAL ALMA ANIMAL
// =============================================================================
const PAPER       = rgb(0xFB / 255, 0xF6 / 255, 0xEC / 255) // #FBF6EC crema cálido
const PAPER_TINT  = rgb(0xF5 / 255, 0xEB / 255, 0xD8 / 255) // #F5EBD8 crema marco foto
const GOLD        = rgb(0xC9 / 255, 0xA5 / 255, 0x5C / 255) // #C9A55C dorado
const NAVY        = rgb(0x1B / 255, 0x2D / 255, 0x5C / 255) // #1B2D5C azul marino
const SUBTLE      = rgb(0x5F / 255, 0x5E / 255, 0x5A / 255) // #5F5E5A texto secundario

const PAGE_W = 612
const PAGE_H = 792 // Letter

export function checkCertificateAssets(): { ok: boolean; missing: string[] } {
  const base = join(process.cwd(), 'public', 'certificates')
  const missing: string[] = []
  if (!existsSync(join(base, 'logo_alma_animal.png'))) missing.push('logo_alma_animal.png')
  return { ok: missing.length === 0, missing }
}

// =============================================================================
// HELPERS DE DIBUJO
// =============================================================================
function drawTracked(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  tracking: number,
  color: ReturnType<typeof rgb>,
) {
  let cursor = x
  for (const ch of text) {
    page.drawText(ch, { x: cursor, y, size, font, color })
    cursor += font.widthOfTextAtSize(ch, size) + tracking
  }
}

function drawTrackedCentered(
  page: PDFPage,
  text: string,
  cx: number,
  y: number,
  font: PDFFont,
  size: number,
  tracking: number,
  color: ReturnType<typeof rgb>,
) {
  const baseW = font.widthOfTextAtSize(text, size)
  const totalW = baseW + tracking * Math.max(0, text.length - 1)
  drawTracked(page, text, cx - totalW / 2, y, font, size, tracking, color)
}

function drawCorner(page: PDFPage, x: number, y: number, dx: number, dy: number, length = 14) {
  page.drawLine({
    start: { x, y },
    end:   { x: x + dx * length, y },
    color: NAVY, thickness: 1.6,
  })
  page.drawLine({
    start: { x, y },
    end:   { x, y: y + dy * length },
    color: NAVY, thickness: 1.6,
  })
}

/**
 * Dibuja una imagen con efecto "cover": rellena el rectángulo destino completo
 * preservando la proporción de la imagen y recortando los lados que sobran
 * (igual que `object-fit: cover` en CSS). El recorte sale del centro.
 */
function drawImageCover(
  page: PDFPage,
  image: PDFImage,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const imgW = image.width
  const imgH = image.height
  if (imgW <= 0 || imgH <= 0) return

  const imgRatio = imgW / imgH
  const rectRatio = w / h

  let drawW: number, drawH: number, drawX: number, drawY: number
  if (imgRatio > rectRatio) {
    // Imagen más ancha que el rect → escalar por altura, recortar lados
    drawH = h
    drawW = h * imgRatio
    drawX = x - (drawW - w) / 2
    drawY = y
  } else {
    // Imagen más alta (o igual) → escalar por ancho, recortar arriba/abajo
    drawW = w
    drawH = w / imgRatio
    drawX = x
    drawY = y - (drawH - h) / 2
  }

  // Aplicar clip al rectángulo destino para que el overflow no se vea
  page.pushOperators(
    pushGraphicsState(),
    rectangle(x, y, w, h),
    clip(),
    endPath(),
  )
  page.drawImage(image, { x: drawX, y: drawY, width: drawW, height: drawH })
  page.pushOperators(popGraphicsState())
}

function detectImageFormat(bytes: Uint8Array): 'png' | 'jpg' | null {
  if (bytes.length < 4) return null
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'png'
  // JPEG: FF D8 FF
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'jpg'
  return null
}

// =============================================================================
// GENERADOR
// =============================================================================
export async function generarCertificadoBuffer(data: CertificadoData): Promise<Buffer> {
  const base = join(process.cwd(), 'public', 'certificates')
  const logoPath = join(base, 'logo_alma_animal.png')
  if (!existsSync(logoPath)) throw new Error(`Logo no encontrado: ${logoPath}`)
  const logoBytes = readFileSync(logoPath)

  const fecha = parseFecha(data.fecha_cremacion_raw)
  const fechaTexto = format(fecha, "d 'de' MMMM, yyyy", { locale: es })

  const pdfDoc = await PDFDocument.create()
  pdfDoc.setTitle(`Certificado de Cremación - ${data.nombre_mascota}`)
  pdfDoc.setAuthor('Alma Animal')
  pdfDoc.setSubject('Certificado de Cremación')
  pdfDoc.setCreator('Alma Animal — Generador de Certificados')

  const page = pdfDoc.addPage([PAGE_W, PAGE_H])

  const logo = await pdfDoc.embedPng(logoBytes)
  const serif       = await pdfDoc.embedFont(StandardFonts.TimesRoman)
  const serifBold   = await pdfDoc.embedFont(StandardFonts.TimesRomanBold)
  const serifItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic)
  const courierBold = await pdfDoc.embedFont(StandardFonts.CourierBold)

  // --- Foto de la mascota (si corresponde) ---
  const usarFoto = !data.sin_foto && data.foto_bytes && data.foto_bytes.length > 0
  let fotoImage = null
  if (usarFoto) {
    const fmt = detectImageFormat(data.foto_bytes!)
    try {
      if (fmt === 'png') fotoImage = await pdfDoc.embedPng(data.foto_bytes!)
      else if (fmt === 'jpg') fotoImage = await pdfDoc.embedJpg(data.foto_bytes!)
    } catch {
      // Si falla la decodificación, generamos sin foto
      fotoImage = null
    }
  }

  // --- Fondo crema ---
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: PAPER })

  // --- Marco doble dorado ---
  const mO = 14, mI = 20
  page.drawRectangle({
    x: mO, y: mO, width: PAGE_W - 2 * mO, height: PAGE_H - 2 * mO,
    borderColor: GOLD, borderWidth: 1.5,
  })
  page.drawRectangle({
    x: mI, y: mI, width: PAGE_W - 2 * mI, height: PAGE_H - 2 * mI,
    borderColor: GOLD, borderWidth: 0.4,
  })

  // --- Esquinas reforzadas en navy ---
  const ci = 30
  drawCorner(page, ci,            PAGE_H - ci, +1, -1)
  drawCorner(page, PAGE_W - ci,   PAGE_H - ci, -1, -1)
  drawCorner(page, ci,            ci,          +1, +1)
  drawCorner(page, PAGE_W - ci,   ci,          -1, +1)

  // --- Logo principal arriba ---
  const logoW = 90, logoH = 90
  const logoX = (PAGE_W - logoW) / 2
  const logoY = PAGE_H - 60 - logoH
  page.drawImage(logo, { x: logoX, y: logoY, width: logoW, height: logoH })

  // --- "EN MEMORIA DE" ---
  const titleY = logoY - 30
  drawTrackedCentered(page, '—  EN MEMORIA DE  —', PAGE_W / 2, titleY, serif, 9, 2.5, GOLD)

  // --- Título "Certificado de Cremación" ---
  const tituloSize = 26
  const tituloW = serif.widthOfTextAtSize('Certificado de Cremación', tituloSize)
  page.drawText('Certificado de Cremación', {
    x: (PAGE_W - tituloW) / 2,
    y: titleY - 28,
    size: tituloSize,
    font: serif,
    color: NAVY,
  })

  // --- Línea decorativa bajo título ---
  page.drawLine({
    start: { x: PAGE_W / 2 - 25, y: titleY - 42 },
    end:   { x: PAGE_W / 2 + 25, y: titleY - 42 },
    color: GOLD, thickness: 1,
  })

  // --- Foto (si aplica) ---
  let dataYStart: number
  if (fotoImage) {
    const photoSize = 95
    const photoX = (PAGE_W - photoSize) / 2
    const photoY = titleY - 42 - 18 - photoSize

    // Marco crema más oscuro + borde dorado
    page.drawRectangle({
      x: photoX, y: photoY, width: photoSize, height: photoSize,
      color: PAPER_TINT, borderColor: GOLD, borderWidth: 1.8,
    })
    // Foto: cover (fill + center-crop) preservando proporción dentro del marco
    drawImageCover(page, fotoImage, photoX + 2, photoY + 2, photoSize - 4, photoSize - 4)
    dataYStart = photoY - 65
  } else {
    // Sin foto: bloque de datos centrado verticalmente
    dataYStart = titleY - 145
  }

  // --- Tabla de datos ---
  const rowH = 26
  const labelX = 105
  const valueX = 195
  const lineEnd = PAGE_W - 105

  const fields: Array<{ label: string; value: string }> = [
    { label: 'NOMBRE',  value: data.nombre_mascota },
    { label: 'ESPECIE', value: data.especie },
    { label: 'FECHA',   value: fechaTexto },
    { label: 'TUTOR',   value: data.nombre_tutor },
    { label: 'CÓDIGO',  value: data.codigo },
  ]

  fields.forEach((f, i) => {
    const y = dataYStart - i * rowH
    drawTracked(page, f.label, labelX, y, serif, 9, 1.5, GOLD)

    let valueFont: PDFFont = serif
    let valueSize = 12
    if (f.label === 'CÓDIGO') {
      valueFont = courierBold
      valueSize = 11
    } else if (f.label === 'NOMBRE') {
      valueFont = serifBold
      valueSize = 13
    }
    page.drawText(f.value, { x: valueX, y, size: valueSize, font: valueFont, color: NAVY })

    page.drawLine({
      start: { x: valueX, y: y - 4 },
      end:   { x: lineEnd, y: y - 4 },
      color: GOLD, thickness: 0.5,
    })
  })

  // --- Frase conmemorativa ---
  const quoteY = dataYStart - fields.length * rowH - 22
  const quoteLines = [
    'Certificamos que la mascota fue recibida y cremada en nuestras',
    'instalaciones bajo un proceso respetuoso y profesional.',
  ]
  quoteLines.forEach((ln, i) => {
    const w = serifItalic.widthOfTextAtSize(ln, 10.5)
    page.drawText(ln, {
      x: (PAGE_W - w) / 2,
      y: quoteY - i * 15,
      size: 10.5, font: serifItalic, color: SUBTLE,
    })
  })

  // --- Firma central ---
  const footerY = 115
  const cx = PAGE_W / 2
  const firmaTexto = 'Crematorio Alma Animal'
  const firmaW = serifItalic.widthOfTextAtSize(firmaTexto, 16)
  page.drawText(firmaTexto, {
    x: cx - firmaW / 2,
    y: footerY + 8,
    size: 16, font: serifItalic, color: NAVY,
  })
  page.drawLine({
    start: { x: cx - 70, y: footerY },
    end:   { x: cx + 70, y: footerY },
    color: NAVY, thickness: 0.5,
  })
  drawTrackedCentered(page, 'FIRMA AUTORIZADA', cx, footerY - 11, serif, 8, 1.5, SUBTLE)

  // --- Logo marca de agua en esquina inferior derecha (alpha 0.18) ---
  const wmSize = 55
  const wmX = PAGE_W - mI - wmSize - 18
  const wmY = mI + 22
  page.drawImage(logo, { x: wmX, y: wmY, width: wmSize, height: wmSize, opacity: 0.18 })

  // --- Footer con lema ---
  drawTrackedCentered(page, 'ALMA ANIMAL  ·  HUELLAS QUE NO SE BORRAN', PAGE_W / 2, 38, serif, 8, 3, GOLD)

  const bytes = await pdfDoc.save()
  return Buffer.from(bytes)
}

function parseFecha(raw: string): Date {
  if (!raw) return new Date()
  // Serial Excel
  if (/^\d+(\.\d+)?$/.test(raw.trim())) {
    const serial = parseFloat(raw)
    if (serial > 1 && serial < 73050) {
      const ms = Math.round((serial - 25569) * 86400 * 1000)
      const utc = new Date(ms)
      return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(), 12)
    }
  }
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return new Date(`${iso[1]}-${iso[2]}-${iso[3]}T12:00:00`)
  const dmy = raw.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})/)
  if (dmy) return new Date(`${dmy[3]}-${dmy[2]}-${dmy[1]}T12:00:00`)
  const d = new Date(raw)
  return isNaN(d.getTime()) ? new Date() : d
}
