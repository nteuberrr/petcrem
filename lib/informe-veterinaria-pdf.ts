import { promises as fs } from 'fs'
import path from 'path'
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage, PDFImage } from 'pdf-lib'
import type { InformeVeterinaria } from './informe-veterinaria'

/**
 * Generador del PDF de facturación a veterinarias. Diseño "de imprenta": banda
 * navy de encabezado (letterhead), tabla con grilla completa (verticales +
 * horizontales) para que se vea "cuadrada", cebrado suave en filas y jerarquía
 * tipográfica clara. Usa la paleta de marca (BRAND en lib/email-layout.ts):
 * navy #143C64 + dorado #F2B84B. El logo (public/logo-alma-mail.png) es la
 * variante BLANCA/dorada — por eso todo header lleva franja navy detrás, si no
 * el trazo blanco del logo desaparece contra el fondo.
 */

// ─── Paleta de marca (navy/dorado — consistente con lib/email-layout.ts BRAND) ───
const NAVY = rgb(0.078, 0.235, 0.392)        // #143C64
const NAVY_SOFT = rgb(0.90, 0.93, 0.96)      // tinte navy muy claro (fills)
const GOLD = rgb(0.949, 0.722, 0.294)        // #F2B84B
const INK = rgb(0.122, 0.161, 0.216)         // texto principal
const MUTED = rgb(0.32, 0.38, 0.46)          // texto secundario
const FAINT = rgb(0.60, 0.63, 0.68)          // microcopy / footer
const CREAM = rgb(0.984, 0.973, 0.953)       // #FBF8F3 — fondo cálido
const LINE = rgb(0.85, 0.83, 0.79)           // líneas de grilla (cálidas, no grises frías)
const LINE_SOFT = rgb(0.92, 0.90, 0.87)      // divisores livianos
const WHITE = rgb(1, 1, 1)
const ZEBRA = rgb(0.976, 0.972, 0.963)       // cebrado sutil

// ─── Layout (A4) ───
const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN_X = 48
const MARGIN_TOP = 56
const MARGIN_BOTTOM = 56
const CONTENT_W = PAGE_W - MARGIN_X * 2
const BAND_H = 46          // banda navy de encabezado (páginas 2+)
const BAND_H_PORTADA = 104 // banda navy de la portada (más alta)

function fmtCLP(n: number): string {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n)
}

/**
 * Sanitiza una string para StandardFonts.Helvetica (encoding WinAnsi/CP-1252,
 * no soporta Unicode fuera de él: flechas, en/em-dash, comillas tipográficas).
 * Cambiar a una TTF embebida soportaría Unicode completo pero suma peso al
 * bundle y al PDF; para este informe alcanza con reemplazos ASCII.
 */
function wa(s: string): string {
  if (!s) return ''
  return s
    .replace(/→/g, ' a ')
    .replace(/←/g, ' a ')
    .replace(/–/g, '-')
    .replace(/—/g, '-')
    .replace(/[''‚‛]/g, "'")
    .replace(/[""„‟]/g, '"')
    .replace(/…/g, '...')
    .replace(/•/g, '*')
    .replace(/[^\x00-\xff]/g, '?')
}

async function loadLogo(): Promise<Uint8Array | null> {
  try {
    const fp = path.join(process.cwd(), 'public', 'logo-alma-mail.png')
    const buf = await fs.readFile(fp)
    return new Uint8Array(buf)
  } catch {
    return null
  }
}

interface RenderCtx {
  pdf: PDFDocument
  page: PDFPage
  font: PDFFont
  bold: PDFFont
  y: number
  logoImg: PDFImage | null
  informe: InformeVeterinaria
  pageNum: number
}

function newPage(ctx: RenderCtx): void {
  drawFooter(ctx)
  ctx.page = ctx.pdf.addPage([PAGE_W, PAGE_H])
  ctx.pageNum += 1
  drawHeader(ctx)
}

function ensureSpace(ctx: RenderCtx, h: number): void {
  if (ctx.y - h < MARGIN_BOTTOM + 30) newPage(ctx)
}

function drawRightText(ctx: RenderCtx, text: string, rightX: number, y: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>): void {
  const t = wa(text)
  const w = font.widthOfTextAtSize(t, size)
  ctx.page.drawText(t, { x: rightX - w, y, size, font, color })
}

// ─── Banda navy de encabezado (compacta, páginas 2+) ──────────────────────────
function drawHeader(ctx: RenderCtx): void {
  const { page, font, bold, informe, logoImg } = ctx
  page.drawRectangle({ x: 0, y: PAGE_H - BAND_H, width: PAGE_W, height: BAND_H, color: NAVY })
  page.drawRectangle({ x: 0, y: PAGE_H - BAND_H - 2.5, width: PAGE_W, height: 2.5, color: GOLD })

  if (logoImg) {
    const h = 26
    const w = h * (logoImg.width / logoImg.height)
    page.drawImage(logoImg, { x: MARGIN_X, y: PAGE_H - BAND_H / 2 - h / 2, width: w, height: h })
  }
  const textX = MARGIN_X + (logoImg ? 34 : 0)
  page.drawText(wa('CREMATORIO ALMA ANIMAL'), { x: textX, y: PAGE_H - BAND_H / 2 + 3, size: 9.5, font: bold, color: WHITE })
  page.drawText(wa('Informe de facturación'), { x: textX, y: PAGE_H - BAND_H / 2 - 9, size: 7.5, font, color: GOLD })

  const vetTxt = wa(informe.veterinaria.nombre)
  drawRightText(ctx, vetTxt, PAGE_W - MARGIN_X, PAGE_H - BAND_H / 2 + 3, 9.5, bold, WHITE)
  if (informe.veterinaria.rut) {
    drawRightText(ctx, informe.veterinaria.rut, PAGE_W - MARGIN_X, PAGE_H - BAND_H / 2 - 9, 7.5, font, rgb(0.75, 0.82, 0.90))
  }
  ctx.y = PAGE_H - BAND_H - 24
}

function drawFooter(ctx: RenderCtx): void {
  const { page, font, pageNum } = ctx
  page.drawLine({ start: { x: MARGIN_X, y: MARGIN_BOTTOM - 8 }, end: { x: PAGE_W - MARGIN_X, y: MARGIN_BOTTOM - 8 }, thickness: 0.75, color: GOLD })
  page.drawText(wa(`Página ${pageNum}`), { x: MARGIN_X, y: MARGIN_BOTTOM - 22, size: 8, font, color: FAINT })
  drawRightText(ctx, 'crematorioalmaanimal.cl · contacto@crematorioalmaanimal.cl', PAGE_W - MARGIN_X, MARGIN_BOTTOM - 22, 8, font, FAINT)
}

// ─── Portada: banda navy alta (letterhead) + tarjetas Emitido por / Dirigido a ───
function drawPortada(ctx: RenderCtx): void {
  const { page, font, bold, informe, logoImg } = ctx

  page.drawRectangle({ x: 0, y: PAGE_H - BAND_H_PORTADA, width: PAGE_W, height: BAND_H_PORTADA, color: NAVY })
  page.drawRectangle({ x: 0, y: PAGE_H - BAND_H_PORTADA - 3, width: PAGE_W, height: 3, color: GOLD })

  if (logoImg) {
    const h = 44
    const w = h * (logoImg.width / logoImg.height)
    page.drawImage(logoImg, { x: MARGIN_X, y: PAGE_H - BAND_H_PORTADA / 2 - h / 2, width: w, height: h })
    const textX = MARGIN_X + w + 14
    page.drawText(wa('CREMATORIO ALMA ANIMAL'), { x: textX, y: PAGE_H - BAND_H_PORTADA / 2 + 5, size: 13, font: bold, color: WHITE })
    page.drawText(wa('Cuidamos su recuerdo con respeto'), { x: textX, y: PAGE_H - BAND_H_PORTADA / 2 - 10, size: 8.5, font, color: GOLD })
  }

  drawRightText(ctx, 'INFORME DE FACTURACIÓN', PAGE_W - MARGIN_X, PAGE_H - BAND_H_PORTADA / 2 + 12, 8, bold, GOLD)
  drawRightText(ctx, `Emitido el ${informe.fecha_emision}`, PAGE_W - MARGIN_X, PAGE_H - BAND_H_PORTADA / 2 - 2, 9.5, bold, WHITE)
  drawRightText(ctx, `${informe.totales_generales.total_fichas} ficha${informe.totales_generales.total_fichas !== 1 ? 's' : ''} · ${informe.totales_generales.cantidad_meses} mes${informe.totales_generales.cantidad_meses !== 1 ? 'es' : ''}`, PAGE_W - MARGIN_X, PAGE_H - BAND_H_PORTADA / 2 - 14, 7.5, font, rgb(0.75, 0.82, 0.90))

  let y = PAGE_H - BAND_H_PORTADA - 26

  // Dos tarjetas: Emitido por (barra navy) / Dirigido a (barra dorada)
  const cardGap = 16
  const cardW = (CONTENT_W - cardGap) / 2
  const cardH = 92
  const cardA_X = MARGIN_X
  const cardB_X = MARGIN_X + cardW + cardGap

  const drawCard = (x: number, accent: ReturnType<typeof rgb>, eyebrow: string, eyebrowColor: ReturnType<typeof rgb>, lineas: { text: string; bold?: boolean; size?: number; color?: ReturnType<typeof rgb> }[]) => {
    page.drawRectangle({ x, y: y - cardH, width: cardW, height: cardH, color: CREAM, borderColor: LINE_SOFT, borderWidth: 0.75 })
    page.drawRectangle({ x, y: y - cardH, width: 3, height: cardH, color: accent })
    page.drawText(wa(eyebrow), { x: x + 16, y: y - 18, size: 7.5, font: bold, color: eyebrowColor })
    let ly = y - 34
    for (const l of lineas) {
      if (!l.text) continue
      page.drawText(wa(l.text), { x: x + 16, y: ly, size: l.size ?? 8.5, font: l.bold ? bold : font, color: l.color ?? INK })
      ly -= (l.size ?? 8.5) + 4
    }
  }

  drawCard(cardA_X, NAVY, 'EMITIDO POR', NAVY, [
    { text: 'Crematorio Alma Animal', bold: true, size: 10 },
    { text: 'Cremación de mascotas · Recoleta, Santiago', color: MUTED },
    { text: 'contacto@crematorioalmaanimal.cl', color: MUTED },
    { text: 'www.crematorioalmaanimal.cl', color: MUTED },
  ])
  drawCard(cardB_X, GOLD, 'DIRIGIDO A', rgb(0.62, 0.46, 0.10), [
    { text: informe.veterinaria.nombre, bold: true, size: 10 },
    { text: informe.veterinaria.razon_social || '', color: MUTED },
    { text: informe.veterinaria.rut ? `RUT ${informe.veterinaria.rut}` : '', color: MUTED },
    { text: [informe.veterinaria.direccion, informe.veterinaria.comuna].filter(Boolean).join(', '), color: MUTED },
    { text: [informe.veterinaria.nombre_contacto, informe.veterinaria.telefono].filter(Boolean).join(' · '), color: MUTED },
  ])
  y -= cardH + 18

  // Barra de período (ancho completo)
  const perH = 34
  page.drawRectangle({ x: MARGIN_X, y: y - perH, width: CONTENT_W, height: perH, color: NAVY_SOFT, borderColor: NAVY, borderWidth: 0.75 })
  page.drawText(wa('PERÍODO FACTURADO'), { x: MARGIN_X + 14, y: y - 14, size: 7, font: bold, color: NAVY })
  const desde = informe.rango.desde ?? '—'
  page.drawText(wa(`${desde}  →  ${informe.rango.hasta}`), { x: MARGIN_X + 14, y: y - 26, size: 10.5, font: bold, color: INK })
  page.drawText(wa('La facturación se detalla mes a mes en las páginas siguientes.'), { x: MARGIN_X + 220, y: y - 20, size: 7.5, font, color: MUTED })
  y -= perH + 22

  ctx.y = y
}

function drawTituloMes(ctx: RenderCtx, label: string): void {
  ensureSpace(ctx, 30)
  const h = 24
  ctx.page.drawRectangle({ x: MARGIN_X, y: ctx.y - h, width: CONTENT_W, height: h, color: CREAM })
  ctx.page.drawRectangle({ x: MARGIN_X, y: ctx.y - h, width: 3, height: h, color: GOLD })
  ctx.page.drawText(wa(label.toUpperCase()), { x: MARGIN_X + 14, y: ctx.y - h + 8, size: 11, font: ctx.bold, color: NAVY })
  ctx.y -= h + 8
}

function drawTituloSemana(ctx: RenderCtx, label: string): void {
  ensureSpace(ctx, 14)
  ctx.page.drawCircle({ x: MARGIN_X + 2.5, y: ctx.y - 6, size: 2.5, color: GOLD })
  ctx.page.drawText(wa(label), { x: MARGIN_X + 10, y: ctx.y - 9, size: 8.5, font: ctx.bold, color: MUTED })
  ctx.y -= 14
}

// Tabla con grilla completa: Código · Fecha · Mascota · Serv · Estado · Adicionales · Total
const COLS = [
  { key: 'codigo',            w: 54,  label: 'Código',      align: 'l' as const },
  // Fecha corta (DD-MM): el año ya lo da el encabezado del mes arriba — con
  // DD-MM-YYYY completo la columna quedaba muy angosta y se cortaba ("16-12-20...").
  { key: 'fecha_corta',       w: 40,  label: 'Fecha',       align: 'l' as const },
  { key: 'mascota',           w: 88,  label: 'Mascota',     align: 'l' as const },
  { key: 'codigo_servicio',   w: 30,  label: 'Serv.',       align: 'c' as const },
  // Anchos medidos con font.widthOfTextAtSize (no a ojo): "despachado" @8.5 = 46.3pt,
  // + 16pt de padding (8 c/lado) = 62.3pt mínimo — por eso 66, no menos.
  { key: 'estado',            w: 66,  label: 'Estado',      align: 'l' as const },
  { key: 'adicionales_label', w: 84,  label: 'Adicionales', align: 'l' as const },
  { key: 'precio_total',      w: 137, label: 'Total',       align: 'r' as const, money: true },
]
const TABLE_W = COLS.reduce((s, c) => s + c.w, 0)
const TABLE_X = MARGIN_X + Math.max(0, (CONTENT_W - TABLE_W) / 2)
const ROW_H = 20
const HEAD_H = 22

/** Verticales de la grilla (una por borde de columna, incl. extremos). */
function drawGridVerticals(ctx: RenderCtx, yTop: number, yBottom: number): void {
  let x = TABLE_X
  ctx.page.drawLine({ start: { x, y: yTop }, end: { x, y: yBottom }, thickness: 0.5, color: LINE })
  for (const col of COLS) {
    x += col.w
    ctx.page.drawLine({ start: { x, y: yTop }, end: { x, y: yBottom }, thickness: 0.5, color: LINE })
  }
}

function drawTableHeader(ctx: RenderCtx): void {
  ensureSpace(ctx, HEAD_H + ROW_H)
  const yTop = ctx.y
  ctx.page.drawRectangle({ x: TABLE_X, y: yTop - HEAD_H, width: TABLE_W, height: HEAD_H, color: NAVY })
  let x = TABLE_X
  for (const col of COLS) {
    const label = wa(col.label.toUpperCase())
    const labelW = ctx.bold.widthOfTextAtSize(label, 7.5)
    const tx = col.align === 'r' ? x + col.w - labelW - 8
            : col.align === 'c' ? x + (col.w - labelW) / 2
            : x + 8
    ctx.page.drawText(label, { x: tx, y: yTop - HEAD_H + 8, size: 7.5, font: ctx.bold, color: WHITE })
    x += col.w
  }
  drawGridVerticals(ctx, yTop, yTop - HEAD_H)
  ctx.y -= HEAD_H
}

function truncate(font: PDFFont, txt: string, max: number, size = 9): string {
  let s = wa(txt)
  if (font.widthOfTextAtSize(s, size) <= max) return s
  while (s.length > 0 && font.widthOfTextAtSize(s + '...', size) > max) s = s.slice(0, -1)
  return s + '...'
}

type RowData = Record<string, string | number>

function drawRow(ctx: RenderCtx, row: RowData, zebra: boolean): void {
  ensureSpace(ctx, ROW_H)
  const yTop = ctx.y
  if (zebra) {
    ctx.page.drawRectangle({ x: TABLE_X, y: yTop - ROW_H, width: TABLE_W, height: ROW_H, color: ZEBRA })
  }
  let x = TABLE_X
  for (const col of COLS) {
    let raw = row[col.key]
    let text: string
    if (col.money) {
      text = wa(fmtCLP(Number(raw) || 0))
    } else {
      raw = (raw ?? '').toString()
      text = raw === '' ? '—' : truncate(ctx.font, raw, col.w - 16, 8.5)
    }
    const size = col.money ? 9.5 : 8.5
    const font = col.money ? ctx.bold : ctx.font
    const tw = font.widthOfTextAtSize(text, size)
    const tx = col.align === 'r' ? x + col.w - tw - 8
            : col.align === 'c' ? x + (col.w - tw) / 2
            : x + 8
    ctx.page.drawText(text, {
      x: tx, y: yTop - ROW_H + 6.5, size, font,
      color: col.money ? NAVY : col.key === 'adicionales_label' ? MUTED : INK,
    })
    x += col.w
  }
  drawGridVerticals(ctx, yTop, yTop - ROW_H)
  ctx.page.drawLine({ start: { x: TABLE_X, y: yTop - ROW_H }, end: { x: TABLE_X + TABLE_W, y: yTop - ROW_H }, thickness: 0.5, color: LINE })
  ctx.y -= ROW_H
}

function drawTableBottomBorder(ctx: RenderCtx): void {
  ctx.page.drawLine({ start: { x: TABLE_X, y: ctx.y }, end: { x: TABLE_X + TABLE_W, y: ctx.y }, thickness: 1, color: NAVY })
}

function drawSubtotalSemana(ctx: RenderCtx, label: string, monto: number): void {
  ensureSpace(ctx, ROW_H)
  const h = 18
  const yTop = ctx.y
  ctx.page.drawRectangle({ x: TABLE_X, y: yTop - h, width: TABLE_W, height: h, color: CREAM, borderColor: LINE_SOFT, borderWidth: 0.5 })
  ctx.page.drawText(wa(`Subtotal ${label}`), { x: TABLE_X + 10, y: yTop - h + 5.5, size: 8.5, font: ctx.font, color: MUTED })
  drawRightText(ctx, fmtCLP(monto), TABLE_X + TABLE_W - 10, yTop - h + 5.5, 9.5, ctx.bold, NAVY)
  ctx.y -= h + 4
}

function drawTotalMes(ctx: RenderCtx, mesLabel: string, total: number): void {
  ensureSpace(ctx, 30)
  const h = 28
  const yTop = ctx.y
  ctx.page.drawRectangle({ x: TABLE_X, y: yTop - h, width: TABLE_W, height: h, color: NAVY })
  ctx.page.drawRectangle({ x: TABLE_X, y: yTop - h, width: 3, height: h, color: GOLD })
  ctx.page.drawText(wa(`TOTAL ${mesLabel.toUpperCase()}`), { x: TABLE_X + 14, y: yTop - h / 2 - 4, size: 10, font: ctx.bold, color: WHITE })
  drawRightText(ctx, fmtCLP(total), TABLE_X + TABLE_W - 14, yTop - h / 2 - 4.5, 13, ctx.bold, GOLD)
  ctx.y -= h + 26
}

/** Sección de resumen: tarjeta con barra horizontal por concepto (Concepto | Cant. | Distribución | %). */
function drawResumenSection(ctx: RenderCtx, titulo: string, rows: Array<{ etiqueta: string; count: number }>): void {
  const totalCount = rows.reduce((s, r) => s + r.count, 0)
  if (totalCount === 0) return

  const rowH = 15
  const headH = 20
  const cardH = headH + rows.length * rowH + 10
  ensureSpace(ctx, cardH + 20)

  ctx.page.drawText(wa(titulo.toUpperCase()), { x: MARGIN_X, y: ctx.y - 9, size: 8, font: ctx.bold, color: NAVY })
  ctx.y -= 15

  const tableX = MARGIN_X
  const tableW = CONTENT_W
  const widths = [Math.floor(tableW * 0.30), Math.floor(tableW * 0.10), Math.floor(tableW * 0.46), tableW - Math.floor(tableW * 0.30) - Math.floor(tableW * 0.10) - Math.floor(tableW * 0.46)]

  const yTop = ctx.y
  ctx.page.drawRectangle({ x: tableX, y: yTop - cardH + 10, width: tableW, height: cardH - 10, color: CREAM, borderColor: LINE_SOFT, borderWidth: 0.75 })

  let xH = tableX + 10
  const headers = ['Concepto', 'Cant.', 'Distribución', '%']
  for (let i = 0; i < headers.length; i++) {
    const align = i === 1 ? 'c' : i === 3 ? 'r' : 'l'
    const txt = wa(headers[i].toUpperCase())
    const lw = ctx.bold.widthOfTextAtSize(txt, 6.5)
    const lx = align === 'r' ? xH + widths[i] - lw - 10 : align === 'c' ? xH + (widths[i] - lw) / 2 : xH
    ctx.page.drawText(txt, { x: lx, y: yTop - 12, size: 6.5, font: ctx.bold, color: MUTED })
    xH += widths[i]
  }
  ctx.y -= headH

  for (const r of rows) {
    const pct = totalCount > 0 ? (r.count / totalCount) * 100 : 0
    const pctLabel = (pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)) + '%'
    let xC = tableX + 10
    const concepto = truncate(ctx.font, r.etiqueta, widths[0] - 14, 8)
    ctx.page.drawText(concepto, { x: xC, y: ctx.y - 10, size: 8, font: ctx.font, color: INK })
    xC += widths[0]
    const cantTxt = String(r.count)
    const cantW = ctx.font.widthOfTextAtSize(cantTxt, 8)
    ctx.page.drawText(cantTxt, { x: xC + (widths[1] - cantW) / 2, y: ctx.y - 10, size: 8, font: ctx.font, color: INK })
    xC += widths[1]
    const barAreaW = widths[2] - 16
    const barH = 6
    const barY = ctx.y - 9 - barH / 2 + 2
    ctx.page.drawRectangle({ x: xC, y: barY, width: barAreaW, height: barH, color: LINE_SOFT })
    const fillW = Math.max(2, Math.round(barAreaW * pct / 100))
    ctx.page.drawRectangle({ x: xC, y: barY, width: fillW, height: barH, color: GOLD })
    xC += widths[2]
    drawRightText(ctx, pctLabel, xC + widths[3] - 10, ctx.y - 10, 8, ctx.bold, NAVY)

    ctx.y -= rowH
  }
  ctx.y -= 14
}

async function generarPDFInforme(informe: InformeVeterinaria): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const logoBytes = await loadLogo()
  const logoImg = logoBytes ? await pdf.embedPng(logoBytes).catch(() => null) : null

  const firstPage = pdf.addPage([PAGE_W, PAGE_H])
  const ctx: RenderCtx = { pdf, page: firstPage, font, bold, y: PAGE_H, logoImg: logoImg ?? null, informe, pageNum: 1 }

  drawPortada(ctx)

  for (const mes of informe.meses) {
    drawTituloMes(ctx, mes.mes_label)
    for (const sem of mes.semanas) {
      if (sem.fichas.length === 0) continue
      drawTituloSemana(ctx, sem.semana_label)
      drawTableHeader(ctx)
      let zebra = false
      for (const f of sem.fichas) {
        const fila: RowData = { ...(f as unknown as RowData), fecha_corta: f.fecha_label.slice(0, 5) }
        drawRow(ctx, fila, zebra)
        zebra = !zebra
      }
      drawTableBottomBorder(ctx)
      ctx.y -= 2
      drawSubtotalSemana(ctx, sem.semana_label, sem.subtotal)
    }
    drawTotalMes(ctx, mes.mes_label, mes.total_mes)
  }

  ensureSpace(ctx, 40)
  ctx.page.drawText(wa('RESUMEN HISTÓRICO'), { x: MARGIN_X, y: ctx.y - 10, size: 11, font: bold, color: NAVY })
  ctx.page.drawRectangle({ x: MARGIN_X, y: ctx.y - 15, width: 32, height: 2, color: GOLD })
  ctx.y -= 26

  drawResumenSection(ctx, 'Por especie', informe.resumen.por_especie.map(r => ({ etiqueta: r.especie, count: r.count })))
  drawResumenSection(ctx, 'Por tramo de peso', informe.resumen.por_peso.map(r => ({ etiqueta: r.rango, count: r.count })))
  drawResumenSection(ctx, 'Por tipo de servicio', informe.resumen.por_servicio.map(r => ({ etiqueta: r.codigo, count: r.count })))

  ensureSpace(ctx, 20)
  ctx.page.drawText(wa('La facturación se realiza mes a mes. Ver el total de cada mes en la sección correspondiente.'), { x: MARGIN_X, y: ctx.y - 8, size: 7.5, font, color: FAINT })
  ctx.page.drawText(wa('Consultas: contacto@crematorioalmaanimal.cl'), { x: MARGIN_X, y: ctx.y - 18, size: 7.5, font, color: FAINT })
  ctx.y -= 24

  drawFooter(ctx)

  const bytes = await pdf.save()
  return Buffer.from(bytes)
}

export { generarPDFInforme }
