// Preview de los 2 estilos originales propuestos:
//   A) Pseudo-firma cursiva grande
//   C) Minimal con QR de verificación
// Uso: node scripts/preview-firma-originales.mjs
// Output: tmp_preview_firmas_originales.pdf

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import QRCode from 'qrcode'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const PAPER  = rgb(0xFB/255, 0xF6/255, 0xEC/255)
const GOLD   = rgb(0xC9/255, 0xA5/255, 0x5C/255)
const NAVY   = rgb(0x1B/255, 0x2D/255, 0x5C/255)
const SUBTLE = rgb(0x5F/255, 0x5E/255, 0x5A/255)

const PAGE_W = 612, PAGE_H = 792

function drawTracked(page, text, x, y, font, size, tracking, color) {
  let cursor = x
  for (const ch of text) {
    page.drawText(ch, { x: cursor, y, size, font, color })
    cursor += font.widthOfTextAtSize(ch, size) + tracking
  }
}
function drawTrackedCentered(page, text, cx, y, font, size, tracking, color) {
  const baseW = font.widthOfTextAtSize(text, size)
  const total = baseW + tracking * Math.max(0, text.length - 1)
  drawTracked(page, text, cx - total/2, y, font, size, tracking, color)
}
function centerText(page, text, y, font, size, color) {
  const w = font.widthOfTextAtSize(text, size)
  page.drawText(text, { x: (PAGE_W - w)/2, y, size, font, color })
}

const SIGNER = 'Nicolas Eduardo Teuber De La Sotta'
const FECHA_LARGA = '19 de mayo, 2026 · 14:32 h'
const FECHA_CORTA = '19/05/2026 · 14:32 h'
const CERT_ID = '128'
const VERIFY_URL = 'https://petcrem.almaanimal.cl/v/128'

function drawCertBody(page, fonts, logo, titulo) {
  const { serif, serifBold, serifItalic, courierBold } = fonts

  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: PAPER })
  const mO = 14, mI = 20
  page.drawRectangle({ x: mO, y: mO, width: PAGE_W-2*mO, height: PAGE_H-2*mO, borderColor: GOLD, borderWidth: 1.5 })
  page.drawRectangle({ x: mI, y: mI, width: PAGE_W-2*mI, height: PAGE_H-2*mI, borderColor: GOLD, borderWidth: 0.4 })

  const logoW = 90, logoH = 90
  page.drawImage(logo, { x: (PAGE_W - logoW)/2, y: PAGE_H - 60 - logoH, width: logoW, height: logoH })
  const titleY = PAGE_H - 60 - logoH - 30

  drawTrackedCentered(page, '—  EN MEMORIA DE  —', PAGE_W/2, titleY, serif, 9, 2.5, GOLD)
  centerText(page, 'Certificado de Cremación', titleY - 28, serif, 26, NAVY)
  page.drawLine({ start: { x: PAGE_W/2 - 25, y: titleY - 42 }, end: { x: PAGE_W/2 + 25, y: titleY - 42 }, color: GOLD, thickness: 1 })

  const dataYStart = titleY - 145
  const rowH = 26, labelX = 105, valueX = 195, lineEnd = PAGE_W - 105
  const fields = [
    ['NOMBRE', 'Toby'],
    ['ESPECIE', 'Canino'],
    ['FECHA', '12 de mayo, 2026'],
    ['TUTOR', 'María González'],
    ['CÓDIGO', 'CI-2604'],
  ]
  fields.forEach(([label, value], i) => {
    const y = dataYStart - i * rowH
    drawTracked(page, label, labelX, y, serif, 9, 1.5, GOLD)
    const useCourier = label === 'CÓDIGO'
    const useBold = label === 'NOMBRE'
    page.drawText(value, {
      x: valueX, y,
      size: useCourier ? 11 : useBold ? 13 : 12,
      font: useCourier ? courierBold : useBold ? serifBold : serif,
      color: NAVY,
    })
    page.drawLine({ start: { x: valueX, y: y-4 }, end: { x: lineEnd, y: y-4 }, color: GOLD, thickness: 0.5 })
  })

  const quoteY = dataYStart - fields.length * rowH - 22
  const lines = [
    'Certificamos que la mascota fue recibida y cremada en nuestras',
    'instalaciones bajo un proceso respetuoso y profesional.',
  ]
  lines.forEach((ln, i) => centerText(page, ln, quoteY - i*15, serifItalic, 10.5, SUBTLE))

  centerText(page, titulo, PAGE_H - 28, serifBold, 10, NAVY)

  page.drawImage(logo, { x: PAGE_W - mI - 55 - 18, y: mI + 22, width: 55, height: 55, opacity: 0.18 })
  drawTrackedCentered(page, 'ALMA ANIMAL  ·  HUELLAS QUE NO SE BORRAN', PAGE_W/2, 38, serif, 8, 3, GOLD)
}

// ============================================================
// VARIANTE A — Pseudo-firma cursiva grande (mockup original)
// ============================================================
function drawFirmaA(page, fonts) {
  const { serif, serifItalic } = fonts
  const baseY = 175

  // Nombre del firmante en cursiva grande (Times Italic 24pt) - simula firma manuscrita
  centerText(page, SIGNER, baseY, serifItalic, 24, NAVY)

  // Línea horizontal larga debajo (simula la línea donde uno firma a mano)
  page.drawLine({
    start: { x: PAGE_W/2 - 145, y: baseY - 10 },
    end:   { x: PAGE_W/2 + 145, y: baseY - 10 },
    color: NAVY, thickness: 0.4,
  })

  // Texto chico: "Firmado digitalmente · fecha"
  centerText(page, `Firmado digitalmente · ${FECHA_CORTA}`, baseY - 28, serif, 9.5, SUBTLE)

  // CN del certificado en tracked uppercase muy chico
  drawTrackedCentered(page, `CN: ${SIGNER.toUpperCase()}`, PAGE_W/2, baseY - 45, serif, 7.5, 1.5, GOLD)

  // Cert N° al final
  centerText(page, `Cert N° ${CERT_ID}`, baseY - 60, serif, 8.5, SUBTLE)
}

// ============================================================
// VARIANTE C — Minimal con QR de verificación
// ============================================================
async function drawFirmaC(page, fonts, doc) {
  const { serif, serifBold, serifItalic } = fonts

  // Generar el QR como PNG
  const qrDataUrl = await QRCode.toDataURL(VERIFY_URL, {
    errorCorrectionLevel: 'M',
    margin: 1,
    color: { dark: '#1B2D5C', light: '#FBF6EC' },  // navy sobre crema
    width: 200,
  })
  const qrBase64 = qrDataUrl.replace(/^data:image\/png;base64,/, '')
  const qrImg = await doc.embedPng(Buffer.from(qrBase64, 'base64'))

  // Layout: bloque de texto a la izquierda, QR a la derecha
  const qrSize = 62
  const blockTop = 195
  const cx = PAGE_W / 2
  const groupW = 280  // ancho total texto + gap + QR
  const groupX = cx - groupW / 2
  const qrX = groupX + groupW - qrSize
  const textX = groupX
  const textW = groupW - qrSize - 14

  // Texto a la izquierda
  const headerY = blockTop - 5
  drawTracked(page, 'FIRMADO  DIGITALMENTE  POR', textX, headerY, serif, 7.5, 2, GOLD)

  // Nombre del firmante (puede ir en dos líneas si es muy largo)
  page.drawText(SIGNER, {
    x: textX, y: headerY - 18, size: 11, font: serifBold, color: NAVY, maxWidth: textW,
  })

  // Fecha + Cert N°
  page.drawText(FECHA_LARGA, {
    x: textX, y: headerY - 40, size: 9, font: serif, color: SUBTLE,
  })
  page.drawText(`Certificado N° ${CERT_ID}`, {
    x: textX, y: headerY - 52, size: 9, font: serif, color: SUBTLE,
  })

  // Línea fina gold de remate debajo
  page.drawLine({
    start: { x: textX, y: headerY - 62 },
    end:   { x: textX + textW, y: headerY - 62 },
    color: GOLD, thickness: 0.4,
  })

  // QR a la derecha
  page.drawImage(qrImg, { x: qrX, y: blockTop - qrSize - 5, width: qrSize, height: qrSize })

  // Label chico del QR
  const verifLabel = 'Escanear para verificar'
  const verifW = serifItalic.widthOfTextAtSize(verifLabel, 7.5)
  page.drawText(verifLabel, {
    x: qrX + (qrSize - verifW)/2,
    y: blockTop - qrSize - 17,
    size: 7.5, font: serifItalic, color: SUBTLE,
  })
}

async function main() {
  const logoPath = join(ROOT, 'public', 'certificates', 'logo_alma_animal.png')
  if (!existsSync(logoPath)) {
    console.error('Falta logo:', logoPath)
    process.exit(1)
  }
  const logoBytes = readFileSync(logoPath)

  const doc = await PDFDocument.create()
  const fonts = {
    serif:       await doc.embedFont(StandardFonts.TimesRoman),
    serifBold:   await doc.embedFont(StandardFonts.TimesRomanBold),
    serifItalic: await doc.embedFont(StandardFonts.TimesRomanItalic),
    courierBold: await doc.embedFont(StandardFonts.CourierBold),
  }
  const logo = await doc.embedPng(logoBytes)

  const variants = [
    { title: 'VARIANTE A — Pseudo-firma cursiva (mockup original)', draw: (p, f, d) => drawFirmaA(p, f, d) },
    { title: 'VARIANTE C — Minimal con QR de verificación',         draw: (p, f, d) => drawFirmaC(p, f, d) },
  ]

  for (const v of variants) {
    const page = doc.addPage([PAGE_W, PAGE_H])
    drawCertBody(page, fonts, logo, v.title)
    await v.draw(page, fonts, doc)
  }

  const out = join(ROOT, 'tmp_preview_firmas_originales.pdf')
  writeFileSync(out, await doc.save())
  console.log('OK →', out)
}

main().catch(e => { console.error(e); process.exit(1) })
