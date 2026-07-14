import { PDFDocument, PDFFont, PDFImage, PDFPage, RGB, rgb } from 'pdf-lib'
import sharp from 'sharp'
import { getSheetData } from './datastore'
import { listarImagenes, type ImagenBanco } from './mailing-images'
import { getContacto, LOGO_URL, SELLO_URL } from './email-layout'
import { fmtPrecio } from './format'
import { LETTER, C, embedBrandFonts, wrapText, fitText, type BrandFonts } from './pdf-brand'

/**
 * Catálogo de productos en PDF (formato CARTA, imprimible), branded y profesional,
 * con la tipografía Inter de marca. Se arma SIEMPRE con los datos vigentes.
 * Reglas: cada producto con su foto y valor; ánforas de greda incluidas (foto, sin
 * precio); el servicio Premium permite elegir cualquier ánfora.
 */

const { W: PAGE_W, H: PAGE_H } = LETTER
const MARGIN = 48
const CONTENT_W = PAGE_W - MARGIN * 2

// Acentos de color locales del catálogo.
const HEADER_SUB = rgb(0xcf / 255, 0xdb / 255, 0xe8 / 255)
const GREEN = rgb(0x1d / 255, 0x7a / 255, 0x4f / 255)
const GREEN_SOFT = rgb(0xE9 / 255, 0xF5 / 255, 0xEC / 255)

interface Producto { id: string; nombre: string; categoria: string; precio: string; foto_url: string; activo: string }

// ── Coincidencia de fotos por nombre (banco grupo "productos") ──
const RE_ACENTOS = new RegExp('[\\u0300-\\u036f]', 'g')
function norm(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(RE_ACENTOS, '').replace(/[^a-z0-9]+/g, ' ').trim()
}
function toks(s: string): string[] { return norm(s).split(' ').filter(t => t.length > 2) }
function matchFoto(nombre: string, banco: ImagenBanco[]): string {
  const pt = toks(nombre)
  let best: ImagenBanco | null = null
  let bestScore = 0
  for (const b of banco) {
    const bt = toks(b.descripcion || b.alt || '')
    let sc = 0
    for (const t of pt) if (bt.includes(t)) sc++
    if (sc === 0) {
      for (const t of pt) for (const u of bt) {
        if (t.length >= 5 && u.length >= 5 && (t.startsWith(u.slice(0, 5)) || u.startsWith(t.slice(0, 5)))) sc = Math.max(sc, 0.5)
      }
    }
    if (sc > bestScore) { bestScore = sc; best = b }
  }
  return bestScore >= 0.5 && best ? best.url : ''
}

async function cargarImagen(doc: PDFDocument, url: string): Promise<PDFImage | null> {
  if (!url) return null
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    const jpg = await sharp(buf).resize({ width: 680, height: 680, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 84 }).toBuffer()
    return await doc.embedJpg(Uint8Array.from(jpg))
  } catch { return null }
}
async function cargarPng(doc: PDFDocument, url: string): Promise<PDFImage | null> {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    return await doc.embedPng(Uint8Array.from(Buffer.from(await r.arrayBuffer())))
  } catch { return null }
}

export async function generarCatalogoPdf(): Promise<Buffer> {
  const [prodRows, banco, contacto, otrosRows] = await Promise.all([
    getSheetData('productos'),
    listarImagenes().catch(() => [] as ImagenBanco[]),
    getContacto(),
    getSheetData('otros_servicios').catch(() => [] as Record<string, string>[]),
  ])
  const bancoProd = banco.filter(b => (b.grupo || '') === 'productos' && b.url)
  const productos = (prodRows as unknown as Producto[]).filter(p => p.activo !== 'FALSE' && (p.nombre || '').trim())

  const cats: { nombre: string; items: Producto[] }[] = []
  for (const p of productos) {
    const cat = (p.categoria || 'Otros').trim() || 'Otros'
    let g = cats.find(c => c.nombre.toLowerCase() === cat.toLowerCase())
    if (!g) { g = { nombre: cat, items: [] }; cats.push(g) }
    g.items.push(p)
  }
  const esGreda = (c: string) => /greda/i.test(c)
  const esPremium = (c: string) => /premium/i.test(c)
  const precioDe = (p: Producto) => parseInt(p.precio, 10) || 0

  const doc = await PDFDocument.create()
  const f: BrandFonts = await embedBrandFonts(doc)
  const logo = await cargarPng(doc, LOGO_URL)
  const sello = await cargarPng(doc, SELLO_URL)

  let page: PDFPage = null as unknown as PDFPage
  let y = 0
  let pageNo = 0

  const text = (s: string, x: number, yy: number, size: number, font: PDFFont, color: RGB) => page.drawText(s, { x, y: yy, size, font, color })

  function footer() {
    page.drawRectangle({ x: MARGIN, y: 40, width: CONTENT_W, height: 0.7, color: C.lineSoft })
    text('Crematorio Alma Animal · Huellas que no se borran', MARGIN, 28, 8, f.regular, C.muted)
    const pn = String(pageNo)
    text(pn, PAGE_W - MARGIN - f.regular.widthOfTextAtSize(pn, 8), 28, 8, f.regular, C.muted)
  }
  function nuevaPagina(conCabecera = false) {
    page = doc.addPage([PAGE_W, PAGE_H])
    pageNo += 1
    page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: C.white })
    footer()
    if (conCabecera) {
      const h = 122
      page.drawRectangle({ x: 0, y: PAGE_H - h, width: PAGE_W, height: h, color: C.navy })
      page.drawRectangle({ x: 0, y: PAGE_H - h - 4, width: PAGE_W, height: 4, color: C.gold })
      text('CREMATORIO ALMA ANIMAL', MARGIN, PAGE_H - 44, 10, f.semibold, C.gold)
      text('Catálogo de productos', MARGIN, PAGE_H - 76, 25, f.bold, C.white)
      text('Ánforas, relicarios y opciones para la despedida de tu mascota', MARGIN, PAGE_H - 98, 11, f.regular, HEADER_SUB)
      if (logo) {
        const lw = 66, lh = (logo.height / logo.width) * lw
        page.drawImage(logo, { x: PAGE_W - MARGIN - lw, y: PAGE_H - 28 - lh, width: lw, height: lh })
      }
      y = PAGE_H - h - 4 - 30
    } else {
      text('CREMATORIO ALMA ANIMAL', MARGIN, PAGE_H - 40, 7.5, f.semibold, C.navySoft)
      page.drawRectangle({ x: MARGIN, y: PAGE_H - 48, width: CONTENT_W, height: 0.7, color: C.lineSoft })
      y = PAGE_H - 72
    }
  }
  const need = (h: number) => { if (y - h < 60) nuevaPagina() }
  const gap = (h: number) => { y -= h }

  function tituloSeccion(txt: string, sub?: string) {
    need(sub ? 62 : 44)
    gap(6)
    page.drawRectangle({ x: MARGIN, y: y - 3, width: 4, height: 19, color: C.gold })
    text(txt, MARGIN + 13, y, 15.5, f.bold, C.navy)
    gap(18)
    page.drawRectangle({ x: MARGIN, y: y + 2, width: CONTENT_W, height: 0.7, color: C.line })
    gap(sub ? 8 : 14)
    if (sub) {
      for (const ln of wrapText(sub, f.regular, 10, CONTENT_W)) { text(ln, MARGIN, y, 10, f.regular, C.muted); gap(14) }
      gap(4)
    }
  }

  nuevaPagina(true)

  // ── Modalidades ──
  tituloSeccion('Modalidades de servicio')
  const LABEL_W = 122
  // Mantener alineado con MODALIDADES_SERVICIOS (lib/diferenciadores.ts), la
  // fuente única de qué incluye cada servicio.
  const modalidades: [string, string][] = [
    ['Individual', 'Certificado de cremación digital, ánfora de greda marmoleada, botellita con mechón de pelo, etiqueta de madera con el nombre, retiro en domicilio o clínica y entrega en 4 días hábiles.'],
    ['Premium', 'Todo lo de Individual y, además, un cuadro en acuarela conmemorativo y ánfora premium a elección de esta selección.'],
    ['Sin Devolución', 'Certificado de cremación y retiro en domicilio o clínica, sin devolución de cenizas (la opción más económica).'],
  ]
  for (const [t, d] of modalidades) {
    const lines = wrapText(d, f.regular, 10.5, CONTENT_W - LABEL_W - 16)
    const cardH = Math.max(42, 18 + lines.length * 13.5)
    need(cardH + 9)
    page.drawRectangle({ x: MARGIN, y: y - cardH, width: CONTENT_W, height: cardH, color: C.white, borderColor: C.line, borderWidth: 1 })
    page.drawRectangle({ x: MARGIN, y: y - cardH, width: 4, height: cardH, color: C.navy })
    text(t, MARGIN + 16, y - cardH / 2 - 3.5, 11.5, f.bold, C.navy)
    let yy = y - 17
    for (const ln of lines) { text(ln, MARGIN + LABEL_W, yy, 10.5, f.regular, C.ink); yy -= 13.5 }
    gap(cardH + 11)
  }
  gap(6)

  // ── Greda incluida ──
  const greda = cats.find(c => esGreda(c.nombre))
  if (greda && greda.items.length) {
    tituloSeccion('Ánfora incluida', 'El ánfora de greda viene incluida por defecto en el servicio, sin costo adicional.')
    // La foto de referencia de la ánfora incluida es la MARMOLEADA MEDIANA
    // (decisión del cliente 2026-07-13); si no está o no tiene foto, cae a la
    // primera de la categoría con foto.
    const normNombre = (s: string) => (s || '').toLowerCase()
    const marmoleadaMediana = greda.items.find(p => normNombre(p.nombre).includes('marmoleada') && normNombre(p.nombre).includes('median'))
    const fotoGreda = marmoleadaMediana?.foto_url || greda.items.map(p => p.foto_url).find(Boolean) || matchFoto('greda marmoleada', bancoProd) || matchFoto(greda.items[0]?.nombre || 'greda', bancoProd)
    const img = await cargarImagen(doc, fotoGreda)
    const boxH = 156
    need(boxH + 12)
    page.drawRectangle({ x: MARGIN, y: y - boxH, width: CONTENT_W, height: boxH, color: C.white, borderColor: C.line, borderWidth: 1 })
    const fw = 168
    page.drawRectangle({ x: MARGIN, y: y - boxH, width: fw, height: boxH, color: C.cream })
    if (img) {
      const scale = Math.min((fw - 24) / img.width, (boxH - 24) / img.height)
      const w = img.width * scale, h = img.height * scale
      page.drawImage(img, { x: MARGIN + (fw - w) / 2, y: y - boxH + (boxH - h) / 2, width: w, height: h })
    }
    page.drawRectangle({ x: MARGIN + fw, y: y - boxH, width: 1, height: boxH, color: C.line })
    const tx = MARGIN + fw + 20
    const tw = CONTENT_W - fw - 40
    text('Ánfora de greda', tx, y - 30, 15, f.bold, C.navy)
    page.drawRectangle({ x: tx, y: y - 56, width: 80, height: 20, color: GREEN_SOFT, borderColor: GREEN, borderWidth: 0.8 })
    text('Incluida', tx + 13, y - 50, 10, f.semibold, GREEN)
    let yy = y - 78
    for (const ln of wrapText(`Disponible en: ${greda.items.map(p => p.nombre).join(' · ')}.`, f.regular, 10, tw)) { text(ln, tx, yy, 10, f.regular, C.ink); yy -= 14 }
    yy -= 3
    for (const ln of wrapText('Se entrega según el tamaño de tu mascota, sin costo adicional.', f.regular, 10, tw)) { text(ln, tx, yy, 10, f.regular, C.muted); yy -= 14 }
    gap(boxH + 16)
  }

  // ── Grilla de productos con precio ──
  async function grilla(nombreSeccion: string, items: Producto[], sub?: string) {
    const visibles = items.filter(p => precioDe(p) > 0)
    if (visibles.length === 0) return
    tituloSeccion(nombreSeccion, sub)
    const cols = 3
    const gx = 16
    const cardW = (CONTENT_W - gx * (cols - 1)) / cols
    const imgH = 124
    const cardH = imgH + 56
    for (let i = 0; i < visibles.length; i++) {
      const col = i % cols
      if (col === 0) need(cardH + 16)
      const x = MARGIN + col * (cardW + gx)
      const top = y
      page.drawRectangle({ x, y: top - cardH, width: cardW, height: cardH, color: C.white, borderColor: C.line, borderWidth: 1 })
      page.drawRectangle({ x, y: top - imgH, width: cardW, height: imgH, color: C.cream })
      page.drawRectangle({ x, y: top - imgH - 0.5, width: cardW, height: 0.7, color: C.line })
      const p = visibles[i]
      const img = await cargarImagen(doc, p.foto_url || matchFoto(p.nombre, bancoProd))
      if (img) {
        const scale = Math.min((cardW - 20) / img.width, (imgH - 14) / img.height)
        const w = img.width * scale, h = img.height * scale
        page.drawImage(img, { x: x + (cardW - w) / 2, y: top - imgH + (imgH - h) / 2, width: w, height: h })
      } else {
        text('sin foto', x + cardW / 2 - f.regular.widthOfTextAtSize('sin foto', 8) / 2, top - imgH / 2, 8, f.regular, C.muted)
      }
      text(fitText(p.nombre, f.semibold, 10.5, cardW - 20), x + 11, top - imgH - 22, 10.5, f.semibold, C.ink)
      page.drawRectangle({ x: x + 11, y: top - imgH - 30, width: 16, height: 2, color: C.gold })
      text(fmtPrecio(precioDe(p)), x + 11, top - imgH - 46, 12.5, f.bold, C.navy)
      if (col === cols - 1 || i === visibles.length - 1) gap(cardH + 16)
    }
  }

  const premium = cats.find(c => esPremium(c.nombre))
  if (premium) await grilla('Ánforas Premium', premium.items, 'Valor por unidad. Con el servicio Premium puedes elegir cualquiera de estas ánforas sin costo adicional.')
  for (const c of cats) {
    if (esGreda(c.nombre) || esPremium(c.nombre)) continue
    await grilla(c.nombre, c.items)
  }

  // ── Servicios adicionales (otros_servicios activos: recargos + express) ──
  const servicios = (otrosRows as Record<string, string>[])
    .filter(s => String(s.activo || '').toUpperCase() === 'TRUE' && (s.nombre || '').trim())
  if (servicios.length) {
    tituloSeccion('Servicios adicionales', 'Servicios opcionales que pueden sumarse a la cremación. Los recargos de retiro se avisan siempre antes de coordinar.')
    for (const s of servicios) {
      const precio = parseInt(s.precio, 10) || 0
      let det = ''
      if (s.auto_regla === 'fuera_horario') {
        det = 'Retiros después de las 19:00 hrs (lunes a viernes), y todo el día los fines de semana y feriados.'
      } else if (s.auto_regla === 'distancia') {
        let comunas: string[] = []
        try { const x = JSON.parse(s.comunas || '[]'); if (Array.isArray(x)) comunas = x.map(String) } catch { /* sin lista */ }
        det = comunas.length ? `Aplica en: ${comunas.join(', ')}.` : 'Aplica en comunas más alejadas de la Región Metropolitana.'
      }
      const detLines = det ? wrapText(det, f.regular, 10, CONTENT_W - 180) : []
      const cardH = Math.max(34, 22 + detLines.length * 13)
      need(cardH + 9)
      page.drawRectangle({ x: MARGIN, y: y - cardH, width: CONTENT_W, height: cardH, color: C.white, borderColor: C.line, borderWidth: 1 })
      page.drawRectangle({ x: MARGIN, y: y - cardH, width: 4, height: cardH, color: C.gold })
      text(s.nombre, MARGIN + 16, y - 18, 11.5, f.semibold, C.navy)
      const pTxt = '+' + fmtPrecio(precio)
      text(pTxt, MARGIN + CONTENT_W - 14 - f.bold.widthOfTextAtSize(pTxt, 12), y - 18, 12, f.bold, C.navy)
      let yy = y - 34
      for (const ln of detLines) { text(ln, MARGIN + 16, yy, 10, f.regular, C.muted); yy -= 13 }
      gap(cardH + 9)
    }
    gap(6)
  }

  // ── Cierre ──
  need(96)
  gap(8)
  page.drawRectangle({ x: MARGIN, y: y, width: CONTENT_W, height: 0.8, color: C.line })
  gap(22)
  text('¿Te interesa alguna opción? Escríbenos:', MARGIN, y, 11, f.bold, C.navy)
  gap(17)
  text(`Correo: ${contacto.correo}`, MARGIN, y, 10, f.regular, C.ink); gap(14)
  text(`Teléfono: ${contacto.telefono}`, MARGIN, y, 10, f.regular, C.ink); gap(14)
  text(`${contacto.nombre} · ${contacto.web}`, MARGIN, y, 10, f.regular, C.muted)
  if (sello) {
    const sw = 68, sh = (sello.height / sello.width) * sw
    page.drawImage(sello, { x: PAGE_W - MARGIN - sw, y: y - 8, width: sw, height: sh })
  }

  return Buffer.from(await doc.save())
}
