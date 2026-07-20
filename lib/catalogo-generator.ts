import { PDFDocument, PDFFont, PDFImage, PDFPage, RGB, rgb } from 'pdf-lib'
import sharp from 'sharp'
import { getSheetData } from './datastore'
import { listarImagenes, type ImagenBanco } from './mailing-images'
import { getContacto, LOGO_URL, SELLO_URL } from './email-layout'
import { fmtPrecio } from './format'
import { LETTER, C, embedBrandFonts, wrapText, fitText, type BrandFonts } from './pdf-brand'

/**
 * Catálogo de servicios y productos en PDF (formato CARTA, imprimible), al mismo
 * estándar "de imprenta" que el informe de facturación a veterinarias
 * (lib/informe-veterinaria-pdf.ts): banda navy en TODAS las páginas + filete
 * dorado, tarjetas con barra de acento, tabla comparativa con grilla completa y
 * footer con paginación.
 *
 * Estructura (pedido del dueño 2026-07-15):
 *   1. Nuestros servicios — qué incluye cada modalidad, con foto referencial
 *      del kit (banco i-11 = kit Individual, i-5 = set Premium) y "desde $".
 *   2. Tabla comparativa de las tres modalidades.
 *   3. Catálogo completo: ánforas de greda (incluidas), premium, relicarios y
 *      el resto — TODOS los productos activos; los sin stock salen marcados
 *      "Agotado" (no se ocultan).
 *   4. Servicios adicionales (otros_servicios activos) y cierre de contacto.
 *
 * Los textos de qué incluye cada servicio siguen MODALIDADES_SERVICIOS
 * (lib/diferenciadores.ts), la fuente única oficial.
 */

const { W: PAGE_W, H: PAGE_H } = LETTER
const MARGIN = 48
const CONTENT_W = PAGE_W - MARGIN * 2
const BAND_H = 42 // banda navy compacta (páginas 2+)

// Acentos de color locales del catálogo.
const HEADER_SUB = rgb(0xcf / 255, 0xdb / 255, 0xe8 / 255)
const GREEN = rgb(0x1d / 255, 0x7a / 255, 0x4f / 255)
const GREEN_SOFT = rgb(0xE9 / 255, 0xF5 / 255, 0xEC / 255)
const RED = rgb(0xB4 / 255, 0x2B / 255, 0x22 / 255)
const RED_SOFT = rgb(0xFB / 255, 0xEC / 255, 0xEA / 255)

interface Producto { id: string; nombre: string; categoria: string; precio: string; stock: string; foto_url: string; activo: string }

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

/** Mínimo > 0 de una columna de la tabla de precios (para el "Desde $"). */
function desdeDe(tramos: Record<string, string>[], col: string): number {
  let min = 0
  for (const t of tramos) {
    const v = parseInt(String(t[col] ?? '').replace(/\D/g, ''), 10) || 0
    if (v > 0 && (min === 0 || v < min)) min = v
  }
  return min
}

// ── Contenido oficial de los servicios (alineado con MODALIDADES_SERVICIOS) ──
interface Servicio {
  nombre: string
  colPrecio: string
  descripcion: string
  incluye: string[]
  fotoCodigo?: string     // código del banco (i-N) de la foto referencial del kit
  fotoCaption?: string
}
const SERVICIOS: Servicio[] = [
  {
    nombre: 'Cremación Individual',
    colPrecio: 'precio_ci',
    descripcion: 'La modalidad más elegida: una despedida íntima, con devolución de las cenizas de tu mascota para conservar su recuerdo en casa.',
    incluye: [
      'Ánfora de greda marmoleada',
      'Certificado de cremación digital',
      'Botellita con mechón de pelo',
      'Etiqueta de madera con el nombre',
      'Retiro en domicilio o clínica',
      'Entrega en 4 días hábiles',
    ],
    fotoCodigo: 'i-11',
    fotoCaption: 'Kit incluido (referencial)',
  },
  {
    nombre: 'Cremación Premium',
    colPrecio: 'precio_cp',
    descripcion: 'Una despedida más especial: todo lo de la Cremación Individual, más recuerdos conmemorativos únicos y el ánfora que tú elijas.',
    incluye: [
      'Todo lo de la Cremación Individual',
      'Cuadro en acuarela conmemorativo de tu mascota',
      'Ánfora premium a elección del catálogo',
    ],
    fotoCodigo: 'i-5',
    fotoCaption: 'Set Premium (referencial)',
  },
  {
    nombre: 'Cremación Sin Devolución',
    colPrecio: 'precio_sd',
    descripcion: 'Una alternativa respetuosa y más simple, sin entrega posterior de cenizas: estas se integran con tierra y plantas vivas, en un ciclo natural de despedida.',
    incluye: [
      'Certificado de cremación digital',
      'Retiro en domicilio o clínica',
      'La opción más económica',
    ],
  },
]

// Tabla comparativa: [concepto, Individual, Premium, Sin Devolución]
const COMPARA: [string, string, string, string][] = [
  ['Retiro en domicilio o clínica', 'Sí', 'Sí', 'Sí'],
  ['Certificado de cremación digital', 'Sí', 'Sí', 'Sí'],
  ['Devolución de cenizas', 'Sí', 'Sí', '—'],
  ['Ánfora', 'Greda marmoleada', 'Premium a elección', '—'],
  ['Botellita con mechón de pelo', 'Sí', 'Sí', '—'],
  ['Etiqueta de madera con el nombre', 'Sí', 'Sí', '—'],
  ['Cuadro en acuarela conmemorativo', '—', 'Sí', '—'],
  ['Entrega de cenizas', '4 días hábiles', '4 días hábiles', '—'],
]

export async function generarCatalogoPdf(): Promise<Buffer> {
  const [prodRows, banco, contacto, otrosRows, preciosG] = await Promise.all([
    getSheetData('productos'),
    listarImagenes().catch(() => [] as ImagenBanco[]),
    getContacto(),
    getSheetData('otros_servicios').catch(() => [] as Record<string, string>[]),
    getSheetData('precios_generales').catch(() => [] as Record<string, string>[]),
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
  const agotado = (p: Producto) => (parseInt(p.stock || '0', 10) || 0) <= 0

  const doc = await PDFDocument.create()
  const f: BrandFonts = await embedBrandFonts(doc)
  const logo = await cargarPng(doc, LOGO_URL)
  const sello = await cargarPng(doc, SELLO_URL)

  let page: PDFPage = null as unknown as PDFPage
  let y = 0
  let pageNo = 0

  const text = (s: string, x: number, yy: number, size: number, font: PDFFont, color: RGB) => page.drawText(s, { x, y: yy, size, font, color })
  const rightText = (s: string, rightX: number, yy: number, size: number, font: PDFFont, color: RGB) =>
    page.drawText(s, { x: rightX - font.widthOfTextAtSize(s, size), y: yy, size, font, color })

  const webLimpia = (contacto.web || 'crematorioalmaanimal.cl').replace(/^https?:\/\//, '').replace(/\/+$/, '')

  function footer() {
    page.drawRectangle({ x: MARGIN, y: 40, width: CONTENT_W, height: 0.8, color: C.gold })
    text('Crematorio Alma Animal · Huellas que no se borran', MARGIN, 28, 8, f.regular, C.muted)
    rightText(`${webLimpia} · Página ${pageNo}`, PAGE_W - MARGIN, 28, 8, f.regular, C.muted)
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
      text('Catálogo de servicios y productos', MARGIN, PAGE_H - 76, 24, f.bold, C.white)
      // El subtítulo no debe invadir el área del logo (esquina derecha de la banda).
      text(fitText('Modalidades de cremación, ánforas, relicarios y recuerdos para tu mascota', f.regular, 10.5, CONTENT_W - 130), MARGIN, PAGE_H - 98, 10.5, f.regular, HEADER_SUB)
      if (logo) {
        const lw = 66, lh = (logo.height / logo.width) * lw
        page.drawImage(logo, { x: PAGE_W - MARGIN - lw, y: PAGE_H - 28 - lh, width: lw, height: lh })
      }
      y = PAGE_H - h - 4 - 30
    } else {
      // Banda navy compacta (mismo letterhead que el informe a veterinarias).
      page.drawRectangle({ x: 0, y: PAGE_H - BAND_H, width: PAGE_W, height: BAND_H, color: C.navy })
      page.drawRectangle({ x: 0, y: PAGE_H - BAND_H - 2.5, width: PAGE_W, height: 2.5, color: C.gold })
      text('CREMATORIO ALMA ANIMAL', MARGIN, PAGE_H - BAND_H / 2 + 2, 9.5, f.semibold, C.white)
      text('Catálogo de servicios y productos', MARGIN, PAGE_H - BAND_H / 2 - 10, 7.5, f.regular, C.gold)
      if (logo) {
        const lh = 26, lw = (logo.width / logo.height) * lh
        page.drawImage(logo, { x: PAGE_W - MARGIN - lw, y: PAGE_H - BAND_H / 2 - lh / 2, width: lw, height: lh })
      }
      y = PAGE_H - BAND_H - 28
    }
  }
  const need = (h: number) => { if (y - h < 60) nuevaPagina() }
  const gap = (h: number) => { y -= h }

  /** Título de sección; `extraNeed` reserva además el alto del primer bloque para
   *  que el título nunca quede huérfano al pie de la página. */
  function tituloSeccion(txt: string, sub?: string, extraNeed = 0) {
    need((sub ? 62 : 44) + extraNeed)
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

  /** Chip "Agotado" (esquina superior derecha del área de foto de una tarjeta). */
  function chipAgotado(xRight: number, yTop: number) {
    const label = 'Agotado'
    const w = f.semibold.widthOfTextAtSize(label, 7.5) + 14
    page.drawRectangle({ x: xRight - w - 6, y: yTop - 22, width: w, height: 16, color: RED_SOFT, borderColor: RED, borderWidth: 0.8 })
    text(label, xRight - w + 1, yTop - 17.5, 7.5, f.semibold, RED)
  }

  nuevaPagina(true)

  // ── 1. Nuestros servicios ──────────────────────────────────────────────────
  tituloSeccion('Nuestros servicios', 'Tres modalidades de cremación, pensadas para acompañarte con respeto y tranquilidad. El valor final depende del peso de tu mascota.', 150)

  const fotoBanco = (codigo?: string): string => {
    if (!codigo) return ''
    const b = banco.find(i => (i.codigo || '') === codigo && i.url)
    return b?.url || ''
  }

  for (const s of SERVICIOS) {
    const desde = desdeDe(preciosG, s.colPrecio)
    const img = await cargarImagen(doc, fotoBanco(s.fotoCodigo))
    const fotoW = img ? 168 : 0
    const tx = MARGIN + fotoW + (img ? 20 : 16)
    const tw = MARGIN + CONTENT_W - tx - 16

    const descLines = wrapText(s.descripcion, f.regular, 10, tw)
    // alto: título (26) + desc + aire (10) + bullets + padding inferior (14)
    const textH = 30 + descLines.length * 13.5 + 8 + s.incluye.length * 14 + 14
    const cardH = Math.max(img ? 168 : 0, textH)
    need(cardH + 14)

    const top = y
    page.drawRectangle({ x: MARGIN, y: top - cardH, width: CONTENT_W, height: cardH, color: C.white, borderColor: C.line, borderWidth: 1 })
    page.drawRectangle({ x: MARGIN, y: top - cardH, width: 4, height: cardH, color: C.navy })
    if (img) {
      page.drawRectangle({ x: MARGIN + 4, y: top - cardH, width: fotoW - 4, height: cardH, color: C.cream })
      const capH = s.fotoCaption ? 16 : 0
      const scale = Math.min((fotoW - 26) / img.width, (cardH - 22 - capH) / img.height)
      const w = img.width * scale, h = img.height * scale
      page.drawImage(img, { x: MARGIN + 4 + (fotoW - 4 - w) / 2, y: top - cardH + capH + (cardH - capH - h) / 2, width: w, height: h })
      if (s.fotoCaption) {
        const cw = f.regular.widthOfTextAtSize(s.fotoCaption, 7)
        text(s.fotoCaption, MARGIN + 4 + (fotoW - 4 - cw) / 2, top - cardH + 8, 7, f.regular, C.muted)
      }
      page.drawRectangle({ x: MARGIN + fotoW, y: top - cardH, width: 1, height: cardH, color: C.line })
    }

    // Título + "Desde $"
    text(s.nombre, tx, top - 26, 13.5, f.bold, C.navy)
    if (desde > 0) {
      const dTxt = `Desde ${fmtPrecio(desde)}`
      const dw = f.semibold.widthOfTextAtSize(dTxt, 10)
      page.drawRectangle({ x: MARGIN + CONTENT_W - 16 - dw - 18, y: top - 32, width: dw + 18, height: 19, color: C.cream, borderColor: C.gold, borderWidth: 0.9 })
      text(dTxt, MARGIN + CONTENT_W - 16 - dw - 9, top - 26.5, 10, f.semibold, C.navy)
    }
    let yy = top - 46
    for (const ln of descLines) { text(ln, tx, yy, 10, f.regular, C.ink); yy -= 13.5 }
    yy -= 6
    for (const it of s.incluye) {
      page.drawCircle({ x: tx + 3, y: yy + 3, size: 2, color: C.gold })
      text(it, tx + 12, yy, 9.5, f.regular, C.ink)
      yy -= 14
    }
    gap(cardH + 14)
  }
  gap(4)

  // ── 2. Comparación de servicios (tabla con grilla completa) ────────────────
  const COL0_W = 190
  const COLS_W = (CONTENT_W - COL0_W) / 3
  const HEAD_H = 24
  const ROW_H = 20
  const filasCompara: [string, string, string, string][] = [
    ...COMPARA,
    ['Valor', ...(['precio_ci', 'precio_cp', 'precio_sd'].map(col => {
      const v = desdeDe(preciosG, col)
      return v > 0 ? `Desde ${fmtPrecio(v)}` : 'Consultar'
    }) as [string, string, string])],
  ]

  function verticalesCompara(yTop: number, yBottom: number) {
    let x = MARGIN
    page.drawLine({ start: { x, y: yTop }, end: { x, y: yBottom }, thickness: 0.5, color: C.line })
    for (const w of [COL0_W, COLS_W, COLS_W, COLS_W]) {
      x += w
      page.drawLine({ start: { x, y: yTop }, end: { x, y: yBottom }, thickness: 0.5, color: C.line })
    }
  }
  function cabeceraCompara() {
    const yTop = y
    page.drawRectangle({ x: MARGIN, y: yTop - HEAD_H, width: CONTENT_W, height: HEAD_H, color: C.navy })
    text('INCLUYE', MARGIN + 10, yTop - HEAD_H + 8.5, 8, f.semibold, C.white)
    const heads = ['Individual', 'Premium', 'Sin Devolución']
    let x = MARGIN + COL0_W
    for (const hlabel of heads) {
      const w = f.semibold.widthOfTextAtSize(hlabel, 8.5)
      text(hlabel, x + (COLS_W - w) / 2, yTop - HEAD_H + 8.5, 8.5, f.semibold, C.white)
      x += COLS_W
    }
    verticalesCompara(yTop, yTop - HEAD_H)
    gap(HEAD_H)
  }

  tituloSeccion('Comparación de servicios', undefined, HEAD_H + ROW_H * 2)
  cabeceraCompara()
  let zebra = false
  for (let i = 0; i < filasCompara.length; i++) {
    const [concepto, a, b, c2] = filasCompara[i]
    const esValor = i === filasCompara.length - 1
    if (y - ROW_H < 60) { nuevaPagina(); cabeceraCompara(); zebra = false }
    const yTop = y
    if (esValor) page.drawRectangle({ x: MARGIN, y: yTop - ROW_H, width: CONTENT_W, height: ROW_H, color: C.cream })
    else if (zebra) page.drawRectangle({ x: MARGIN, y: yTop - ROW_H, width: CONTENT_W, height: ROW_H, color: C.zebra })
    text(concepto, MARGIN + 10, yTop - ROW_H + 6.5, 8.5, esValor ? f.semibold : f.regular, C.ink)
    let x = MARGIN + COL0_W
    for (const val of [a, b, c2]) {
      const font = esValor ? f.bold : val === 'Sí' ? f.semibold : f.regular
      const color = esValor ? C.navy : val === '—' ? C.muted : val === 'Sí' ? GREEN : C.ink
      const size = esValor ? 9 : 8.5
      const w = font.widthOfTextAtSize(val, size)
      text(val, x + (COLS_W - w) / 2, yTop - ROW_H + 6.5, size, font, color)
      x += COLS_W
    }
    verticalesCompara(yTop, yTop - ROW_H)
    page.drawLine({ start: { x: MARGIN, y: yTop - ROW_H }, end: { x: MARGIN + CONTENT_W, y: yTop - ROW_H }, thickness: 0.5, color: C.line })
    gap(ROW_H)
    zebra = !zebra
  }
  page.drawLine({ start: { x: MARGIN, y: y }, end: { x: MARGIN + CONTENT_W, y }, thickness: 1, color: C.navy })
  gap(10)
  for (const ln of wrapText('El valor final se determina por el peso de tu mascota según la tarifa vigente. El Servicio Express (entrega en 2 días hábiles) está disponible como adicional.', f.regular, 8.5, CONTENT_W)) {
    text(ln, MARGIN, y, 8.5, f.regular, C.muted); gap(12)
  }
  gap(10)

  // ── 3. Catálogo de productos (grillas por categoría) ───────────────────────
  async function grilla(nombreSeccion: string, items: Producto[], opts: { sub?: string; incluida?: boolean } = {}) {
    if (items.length === 0) return
    const cols = 3
    const gx = 16
    const cardW = (CONTENT_W - gx * (cols - 1)) / cols
    const imgH = 124
    const cardH = imgH + 56
    tituloSeccion(nombreSeccion, opts.sub, cardH)
    for (let i = 0; i < items.length; i++) {
      const col = i % cols
      if (col === 0) need(cardH + 16)
      const x = MARGIN + col * (cardW + gx)
      const top = y
      page.drawRectangle({ x, y: top - cardH, width: cardW, height: cardH, color: C.white, borderColor: C.line, borderWidth: 1 })
      page.drawRectangle({ x, y: top - imgH, width: cardW, height: imgH, color: C.cream })
      page.drawRectangle({ x, y: top - imgH - 0.5, width: cardW, height: 0.7, color: C.line })
      const p = items[i]
      const img = await cargarImagen(doc, p.foto_url || matchFoto(p.nombre, bancoProd))
      if (img) {
        const scale = Math.min((cardW - 20) / img.width, (imgH - 14) / img.height)
        const w = img.width * scale, h = img.height * scale
        page.drawImage(img, { x: x + (cardW - w) / 2, y: top - imgH + (imgH - h) / 2, width: w, height: h })
      } else {
        text('sin foto', x + cardW / 2 - f.regular.widthOfTextAtSize('sin foto', 8) / 2, top - imgH / 2, 8, f.regular, C.muted)
      }
      if (agotado(p)) chipAgotado(x + cardW, top)
      // Nombre: antes de truncar con "…", intentar tamaños menores para que quepa entero.
      const nombreSize = [10.5, 9.5, 8.5].find(sz => f.semibold.widthOfTextAtSize(p.nombre, sz) <= cardW - 20) ?? 8.5
      text(fitText(p.nombre, f.semibold, nombreSize, cardW - 20), x + 11, top - imgH - 22, nombreSize, f.semibold, C.ink)
      page.drawRectangle({ x: x + 11, y: top - imgH - 30, width: 16, height: 2, color: C.gold })
      if (opts.incluida) {
        page.drawRectangle({ x: x + 11, y: top - imgH - 50, width: 74, height: 18, color: GREEN_SOFT, borderColor: GREEN, borderWidth: 0.8 })
        text('Incluida', x + 11 + (74 - f.semibold.widthOfTextAtSize('Incluida', 9.5)) / 2, top - imgH - 45, 9.5, f.semibold, GREEN)
      } else {
        const precio = precioDe(p)
        text(precio > 0 ? fmtPrecio(precio) : 'Consultar', x + 11, top - imgH - 46, 12.5, f.bold, C.navy)
      }
      if (col === cols - 1 || i === items.length - 1) gap(cardH + 16)
    }
  }

  const greda = cats.find(c => esGreda(c.nombre))
  if (greda) {
    await grilla('Ánforas de greda — incluidas en el servicio', greda.items, {
      sub: 'El ánfora de greda marmoleada viene incluida en la Cremación Individual y Premium, sin costo adicional. Se entrega según el tamaño de tu mascota.',
      incluida: true,
    })
  }
  const premium = cats.find(c => esPremium(c.nombre))
  if (premium) {
    await grilla('Ánforas Premium', premium.items, {
      sub: 'Valor por unidad. Con el servicio Premium puedes elegir cualquiera de estas ánforas sin costo adicional.',
    })
  }
  for (const c of cats) {
    if (esGreda(c.nombre) || esPremium(c.nombre)) continue
    await grilla(c.nombre, c.items)
  }

  // ── 4. Servicios adicionales (otros_servicios activos: recargos + express) ──
  const servicios = (otrosRows as Record<string, string>[])
    .filter(s => String(s.activo || '').toUpperCase() === 'TRUE' && (s.nombre || '').trim())
  if (servicios.length) {
    tituloSeccion('Servicios adicionales', 'Servicios opcionales que pueden sumarse a la cremación. Los recargos de retiro se avisan siempre antes de coordinar.', 44)
    for (const s of servicios) {
      const precio = parseInt(s.precio, 10) || 0
      let det = ''
      if (s.auto_regla === 'fuera_horario') {
        det = 'Retiros después de las 18:00 hrs (lunes a viernes), y todo el día los fines de semana y feriados.'
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
  need(110)
  gap(8)
  page.drawRectangle({ x: MARGIN, y: y, width: CONTENT_W, height: 0.8, color: C.line })
  gap(22)
  text('¿Te interesa alguna opción? Escríbenos:', MARGIN, y, 11, f.bold, C.navy)
  gap(17)
  text(`Correo: ${contacto.correo}`, MARGIN, y, 10, f.regular, C.ink); gap(14)
  text(`Teléfono: ${contacto.telefono}`, MARGIN, y, 10, f.regular, C.ink); gap(14)
  text(`${contacto.nombre} · ${webLimpia}`, MARGIN, y, 10, f.regular, C.muted)
  if (sello) {
    const sw = 68, sh = (sello.height / sello.width) * sw
    page.drawImage(sello, { x: PAGE_W - MARGIN - sw, y: y - 8, width: sw, height: sh })
  }

  return Buffer.from(await doc.save())
}
