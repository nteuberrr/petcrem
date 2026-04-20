import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

export interface CertificadoData {
  nombre_mascota: string
  especie: string
  fecha_cremacion_raw: string
  nombre_tutor: string
  codigo: string
}

export function checkCertificateAssets(): { ok: boolean; missing: string[] } {
  const base = join(process.cwd(), 'public', 'certificates')
  const missing: string[] = []
  if (!existsSync(join(base, 'alma_animal_logo.png'))) missing.push('alma_animal_logo.png')
  if (!existsSync(join(base, 'alma_animal_sello.png'))) missing.push('alma_animal_sello.png')
  return { ok: missing.length === 0, missing }
}

export async function generarCertificadoBuffer(data: CertificadoData): Promise<Buffer> {
  const base = join(process.cwd(), 'public', 'certificates')
  const logoBytes = readFileSync(join(base, 'alma_animal_logo.png'))
  const selloBytes = readFileSync(join(base, 'alma_animal_sello.png'))

  const fecha = parseFecha(data.fecha_cremacion_raw)
  const fechaTexto = format(fecha, "d 'de' MMMM 'de' yyyy", { locale: es })

  const pdfDoc = await PDFDocument.create()
  const page = pdfDoc.addPage([595.28, 841.89]) // A4 portrait (pt)
  const { width, height } = page.getSize()

  const logo = await pdfDoc.embedPng(logoBytes)
  const sello = await pdfDoc.embedPng(selloBytes)
  const serif = await pdfDoc.embedFont(StandardFonts.TimesRoman)
  const serifBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold)
  const serifItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic)

  // Marco
  page.drawRectangle({
    x: 30, y: 30, width: width - 60, height: height - 60,
    borderColor: rgb(0.55, 0.45, 0.25), borderWidth: 1.5,
  })
  page.drawRectangle({
    x: 40, y: 40, width: width - 80, height: height - 80,
    borderColor: rgb(0.75, 0.65, 0.45), borderWidth: 0.5,
  })

  // Logo
  const logoDims = logo.scale(0.22)
  page.drawImage(logo, {
    x: (width - logoDims.width) / 2,
    y: height - 60 - logoDims.height,
    width: logoDims.width,
    height: logoDims.height,
  })

  // Título
  const titulo = 'Certificado de Cremación'
  const tituloSize = 26
  const tituloWidth = serifBold.widthOfTextAtSize(titulo, tituloSize)
  page.drawText(titulo, {
    x: (width - tituloWidth) / 2,
    y: height - 220,
    size: tituloSize,
    font: serifBold,
    color: rgb(0.25, 0.2, 0.15),
  })

  // Línea decorativa
  page.drawLine({
    start: { x: width / 2 - 80, y: height - 240 },
    end: { x: width / 2 + 80, y: height - 240 },
    thickness: 0.8,
    color: rgb(0.55, 0.45, 0.25),
  })

  // Cuerpo
  const cuerpoSize = 13
  const marginX = 80
  let y = height - 290
  const lineHeight = cuerpoSize * 1.8

  const lines: Array<{ text: string; font: typeof serif; size?: number }> = [
    { text: 'Por medio del presente certificamos que', font: serif },
    { text: data.nombre_mascota, font: serifBold, size: 22 },
    { text: `${data.especie ? `(${data.especie})` : ''}`.trim(), font: serifItalic },
    { text: 'ha sido cremado(a) bajo nuestros estándares de cuidado y respeto', font: serif },
    { text: `el día ${fechaTexto},`, font: serif },
    { text: `acompañando siempre a su familia, ${data.nombre_tutor}.`, font: serif },
  ]

  for (const ln of lines) {
    if (!ln.text) { y -= lineHeight * 0.6; continue }
    const size = ln.size ?? cuerpoSize
    const w = ln.font.widthOfTextAtSize(ln.text, size)
    page.drawText(ln.text, {
      x: (width - w) / 2, y,
      size, font: ln.font, color: rgb(0.2, 0.15, 0.1),
    })
    y -= lineHeight * (ln.size ? 1.5 : 1)
  }

  // Código (footer izquierdo)
  page.drawText(`Código: ${data.codigo}`, {
    x: marginX, y: 90,
    size: 10, font: serif, color: rgb(0.4, 0.35, 0.3),
  })

  // Sello (footer derecho)
  const selloDims = sello.scale(0.25)
  page.drawImage(sello, {
    x: width - marginX - selloDims.width,
    y: 70,
    width: selloDims.width,
    height: selloDims.height,
  })

  const bytes = await pdfDoc.save()
  return Buffer.from(bytes)
}

function parseFecha(raw: string): Date {
  if (!raw) return new Date()
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return new Date(`${iso[1]}-${iso[2]}-${iso[3]}T12:00:00`)
  const dmy = raw.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})/)
  if (dmy) return new Date(`${dmy[3]}-${dmy[2]}-${dmy[1]}T12:00:00`)
  const d = new Date(raw)
  return isNaN(d.getTime()) ? new Date() : d
}
