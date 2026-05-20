// Genera un PDF de muestra con 3 variantes del bloque de firma digital,
// todas integradas al estilo del certificado de Alma Animal.
// Uso: node scripts/preview-firma-styles.mjs
// Output: tmp_preview_firmas.pdf (en la raíz del repo)

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const PAPER       = rgb(0xFB/255, 0xF6/255, 0xEC/255)
const PAPER_TINT  = rgb(0xF5/255, 0xEB/255, 0xD8/255)
const GOLD        = rgb(0xC9/255, 0xA5/255, 0x5C/255)
const NAVY        = rgb(0x1B/255, 0x2D/255, 0x5C/255)
const SUBTLE     = rgb(0x5F/255, 0x5E/255, 0x5A/255)

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
const FECHA = '19 de mayo, 2026 · 14:32 h'
const CERT_ID = '128'

function drawCertBody(page, fonts, logo, titulo) {
  const { serif, serifBold, serifItalic, courierBold } = fonts

  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: PAPER })
  const mO = 14, mI = 20
  page.drawRectangle({ x: mO, y: mO, width: PAGE_W-2*mO, height: PAGE_H-2*mO, borderColor: GOLD, borderWidth: 1.5 })
  page.drawRectangle({ x: mI, y: mI, width: PAGE_W-2*mI, height: PAGE_H-2*mI, borderColor: GOLD, borderWidth: 0.4 })

  // Logo
  const logoW = 90, logoH = 90
  page.drawImage(logo, { x: (PAGE_W - logoW)/2, y: PAGE_H - 60 - logoH, width: logoW, height: logoH })
  const titleY = PAGE_H - 60 - logoH - 30

  // EN MEMORIA DE
  drawTrackedCentered(page, '—  EN MEMORIA DE  —', PAGE_W/2, titleY, serif, 9, 2.5, GOLD)

  // Certificado de Cremación
  centerText(page, 'Certificado de Cremación', titleY - 28, serif, 26, NAVY)

  // Linea decorativa
  page.drawLine({ start: { x: PAGE_W/2 - 25, y: titleY - 42 }, end: { x: PAGE_W/2 + 25, y: titleY - 42 }, color: GOLD, thickness: 1 })

  // Bloque datos
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

  // Frase
  const quoteY = dataYStart - fields.length * rowH - 22
  const quoteLines = [
    'Certificamos que la mascota fue recibida y cremada en nuestras',
    'instalaciones bajo un proceso respetuoso y profesional.',
  ]
  quoteLines.forEach((ln, i) => centerText(page, ln, quoteY - i*15, serifItalic, 10.5, SUBTLE))

  // Header de página (qué variante es)
  centerText(page, titulo, PAGE_H - 28, serifBold, 10, NAVY)

  // Watermark + footer
  page.drawImage(logo, { x: PAGE_W - mI - 55 - 18, y: mI + 22, width: 55, height: 55, opacity: 0.18 })
  drawTrackedCentered(page, 'ALMA ANIMAL  ·  HUELLAS QUE NO SE BORRAN', PAGE_W/2, 38, serif, 8, 3, GOLD)
}

// ============================================================
// VARIANTE 1 — "EN MEMORIA DE" mirror (mismo patrón que el título arriba)
// ============================================================
function drawFirmaV1(page, fonts) {
  const { serif, serifBold, serifItalic } = fonts
  const baseY = 175

  // "—  FIRMADO DIGITALMENTE  —" en dorado tracked (espeja el header de arriba)
  drawTrackedCentered(page, '—  FIRMADO DIGITALMENTE  —', PAGE_W/2, baseY, serif, 9, 2.5, GOLD)

  // Nombre del firmante en serif bold navy (matchea "Certificado de Cremación")
  centerText(page, SIGNER, baseY - 28, serifBold, 14, NAVY)

  // Línea decorativa gold corta (matchea la línea bajo el título)
  page.drawLine({ start: { x: PAGE_W/2 - 25, y: baseY - 42 }, end: { x: PAGE_W/2 + 25, y: baseY - 42 }, color: GOLD, thickness: 1 })

  // Fecha + ID en italic gris
  centerText(page, FECHA, baseY - 58, serifItalic, 10.5, SUBTLE)
  centerText(page, `Cert N° ${CERT_ID}`, baseY - 73, serifItalic, 9, SUBTLE)
}

// ============================================================
// VARIANTE 2 — Cursiva manuscrita (estilo firma de pluma)
// ============================================================
function drawFirmaV2(page, fonts) {
  const { serif, serifItalic } = fonts
  const baseY = 175

  // Nombre del firmante grande en italic (como firma de pluma)
  centerText(page, SIGNER, baseY, serifItalic, 22, NAVY)

  // Línea fina larga debajo (no rota la elegancia)
  page.drawLine({ start: { x: PAGE_W/2 - 130, y: baseY - 10 }, end: { x: PAGE_W/2 + 130, y: baseY - 10 }, color: NAVY, thickness: 0.4 })

  // "firmado digitalmente" tracked chico dorado
  drawTrackedCentered(page, 'FIRMADO  DIGITALMENTE', PAGE_W/2, baseY - 25, serif, 7.5, 3, GOLD)

  // Fecha + ID en italic gris
  centerText(page, `${FECHA}  ·  Cert N° ${CERT_ID}`, baseY - 45, serifItalic, 9, SUBTLE)
}

// Dibuja un pequeño diamante relleno (rombo) centrado en (cx, cy)
function drawDiamond(page, cx, cy, size, color) {
  page.drawSvgPath(`M 0 -${size} L ${size} 0 L 0 ${size} L -${size} 0 Z`, {
    x: cx, y: cy, color, borderColor: color, borderWidth: 0,
  })
}

// ============================================================
// VARIANTE 3 — Diamante ornamental (estilo memorial sutil)
// ============================================================
function drawFirmaV3(page, fonts) {
  const { serif, serifItalic } = fonts
  const baseY = 180

  // Diamante dorado arriba
  drawDiamond(page, PAGE_W/2, baseY + 4, 3, GOLD)

  // Header chico
  drawTrackedCentered(page, 'FIRMADO  DIGITALMENTE  POR', PAGE_W/2, baseY - 16, serif, 8, 2.5, GOLD)

  // Nombre en italic navy mediano
  centerText(page, SIGNER, baseY - 36, serifItalic, 14, NAVY)

  // Pequeña linea gold con diamante chico al medio
  const lineY = baseY - 52
  page.drawLine({ start: { x: PAGE_W/2 - 50, y: lineY }, end: { x: PAGE_W/2 - 8, y: lineY }, color: GOLD, thickness: 0.4 })
  drawDiamond(page, PAGE_W/2, lineY, 2, GOLD)
  page.drawLine({ start: { x: PAGE_W/2 + 8, y: lineY }, end: { x: PAGE_W/2 + 50, y: lineY }, color: GOLD, thickness: 0.4 })

  // Fecha + ID compacto en italic
  centerText(page, `${FECHA}  ·  Cert N° ${CERT_ID}`, baseY - 68, serifItalic, 9, SUBTLE)
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
    { title: 'VARIANTE 1 — Patrón "EN MEMORIA DE" (espeja el header)', draw: drawFirmaV1 },
    { title: 'VARIANTE 2 — Firma cursiva manuscrita',                  draw: drawFirmaV2 },
    { title: 'VARIANTE 3 — Diamante ornamental memorial',              draw: drawFirmaV3 },
  ]

  for (const v of variants) {
    const page = doc.addPage([PAGE_W, PAGE_H])
    drawCertBody(page, fonts, logo, v.title)
    v.draw(page, fonts)
  }

  const out = join(ROOT, 'tmp_preview_firmas.pdf')
  writeFileSync(out, await doc.save())
  console.log('OK →', out)
}

main().catch(e => { console.error(e); process.exit(1) })
