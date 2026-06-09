import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { promises as fs } from 'fs'
import path from 'path'
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib'
import { generarInformeVeterinaria, type InformeVeterinaria } from '@/lib/informe-veterinaria'
import { appendRow, ensureSheet, ensureColumns, getSheetData, getNextId } from '@/lib/datastore'
import { uploadToR2 } from '@/lib/cloudflare-r2'
import { todayISO } from '@/lib/dates'
import { esAdmin } from '@/lib/roles'

const INFORMES_COLS = [
  'id', 'veterinaria_id', 'veterinaria_nombre',
  'version', 'formato',
  'periodo_hasta_mes', 'cantidad_meses', 'cantidad_fichas', 'monto_total_clp',
  'fecha_emision', 'hora_emision',
  'emitido_por_id', 'emitido_por_nombre',
  'archivo_key', 'archivo_url',
  'fecha_creacion',
]

// ─── Paleta refinada ───
const C_INK = rgb(0.10, 0.11, 0.14)        // texto principal, casi negro
const C_TXT = rgb(0.22, 0.25, 0.30)        // texto secundario
const C_MUTED = rgb(0.50, 0.54, 0.60)      // labels y meta
const C_FAINT = rgb(0.72, 0.74, 0.78)      // microcopy
const C_ACCENT = rgb(0.33, 0.31, 0.78)     // indigo principal
const C_ACCENT_SOFT = rgb(0.96, 0.96, 1.00) // bg para chips
const C_BG_SOFT = rgb(0.98, 0.98, 0.98)    // bg para zebra y header tabla
const C_LINE = rgb(0.90, 0.91, 0.93)       // hairlines
const C_LINE_DARK = rgb(0.78, 0.80, 0.85)  // bordes más visibles
const C_WHITE = rgb(1, 1, 1)
const C_TOTAL_BG = rgb(0.08, 0.10, 0.14)   // total destacado

// ─── Layout ───
const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN_X = 48
const MARGIN_TOP = 56
const MARGIN_BOTTOM = 56
const CONTENT_W = PAGE_W - MARGIN_X * 2

function fmtCLP(n: number): string {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n)
}

/**
 * Sanitiza una string para que pueda renderizarse con StandardFonts.Helvetica,
 * que usa el encoding WinAnsi (CP-1252) y no soporta caracteres Unicode fuera
 * de él (flechas, en-dash, em-dash, comillas tipográficas, etc.).
 *
 * Cambiar a una fuente TTF embebida soportaría Unicode completo pero suma peso
 * al bundle y al PDF; para este informe alcanza con reemplazos ASCII.
 */
function wa(s: string): string {
  if (!s) return ''
  return s
    .replace(/→/g, ' a ')
    .replace(/←/g, ' a ')
    .replace(/–/g, '-')   // en dash
    .replace(/—/g, '-')   // em dash
    .replace(/[''‚‛]/g, "'")
    .replace(/[""„‟]/g, '"')
    .replace(/…/g, '...')
    .replace(/•/g, '*')
    // Catch-all: cualquier char fuera de Latin-1 lo dejamos como '?'
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
  logoImg: import('pdf-lib').PDFImage | null
  informe: InformeVeterinaria
  pageNum: number
}

function newPage(ctx: RenderCtx): void {
  // Footer de la página anterior
  drawFooter(ctx)
  ctx.page = ctx.pdf.addPage([PAGE_W, PAGE_H])
  ctx.pageNum += 1
  ctx.y = PAGE_H - MARGIN_TOP
  drawHeader(ctx)
}

function ensureSpace(ctx: RenderCtx, h: number): void {
  if (ctx.y - h < MARGIN_BOTTOM + 30) newPage(ctx)
}

// ─── Header recurrente (compacto, lo dibuja cada página excepto la portada) ───
function drawHeader(ctx: RenderCtx): void {
  const { page, font, bold, informe, logoImg } = ctx
  if (logoImg) {
    const w = 34
    const ratio = logoImg.height / logoImg.width
    page.drawImage(logoImg, {
      x: MARGIN_X,
      y: PAGE_H - MARGIN_TOP - w * ratio + 18,
      width: w,
      height: w * ratio,
    })
  }
  page.drawText(wa('CREMATORIO ALMA ANIMAL'), {
    x: MARGIN_X + 44, y: PAGE_H - MARGIN_TOP + 12,
    size: 8.5, font: bold, color: C_INK,
  })
  page.drawText(wa('Informe de facturación'), {
    x: MARGIN_X + 44, y: PAGE_H - MARGIN_TOP + 2,
    size: 8, font, color: C_MUTED,
  })
  // Vet a la derecha
  const vetTxt = wa(informe.veterinaria.nombre)
  const vetW = bold.widthOfTextAtSize(vetTxt, 9)
  page.drawText(vetTxt, {
    x: PAGE_W - MARGIN_X - vetW, y: PAGE_H - MARGIN_TOP + 12,
    size: 9, font: bold, color: C_INK,
  })
  if (informe.veterinaria.rut) {
    const rutTxt = wa(informe.veterinaria.rut)
    const rutW = font.widthOfTextAtSize(rutTxt, 8)
    page.drawText(rutTxt, {
      x: PAGE_W - MARGIN_X - rutW, y: PAGE_H - MARGIN_TOP + 2,
      size: 8, font, color: C_MUTED,
    })
  }
  page.drawLine({
    start: { x: MARGIN_X, y: PAGE_H - MARGIN_TOP - 8 },
    end: { x: PAGE_W - MARGIN_X, y: PAGE_H - MARGIN_TOP - 8 },
    thickness: 0.4, color: C_LINE,
  })
  ctx.y = PAGE_H - MARGIN_TOP - 22
}

function drawFooter(ctx: RenderCtx): void {
  const { page, font, pageNum } = ctx
  page.drawLine({
    start: { x: MARGIN_X, y: MARGIN_BOTTOM - 8 },
    end: { x: PAGE_W - MARGIN_X, y: MARGIN_BOTTOM - 8 },
    thickness: 0.4, color: C_LINE,
  })
  const left = wa(`Página ${pageNum}`)
  page.drawText(left, { x: MARGIN_X, y: MARGIN_BOTTOM - 22, size: 8, font, color: C_FAINT })
  const right = wa('crematorioalmaanimal.cl · contacto@crematorioalmaanimal.cl')
  const rw = font.widthOfTextAtSize(right, 8)
  page.drawText(right, { x: PAGE_W - MARGIN_X - rw, y: MARGIN_BOTTOM - 22, size: 8, font, color: C_FAINT })
}

// ─── Portada compacta (página 1). Sin total general porque se factura mes a mes. ───
function drawPortada(ctx: RenderCtx): void {
  const { page, font, bold, informe, logoImg } = ctx

  // Logo + nombre
  if (logoImg) {
    const w = 60
    const ratio = logoImg.height / logoImg.width
    page.drawImage(logoImg, {
      x: MARGIN_X,
      y: PAGE_H - MARGIN_TOP - w * ratio + 8,
      width: w,
      height: w * ratio,
    })
  }
  page.drawText(wa('CREMATORIO ALMA ANIMAL'), {
    x: MARGIN_X + 72, y: PAGE_H - MARGIN_TOP - 10,
    size: 10, font: bold, color: C_INK,
  })
  page.drawText(wa('Cuidamos su recuerdo con respeto'), {
    x: MARGIN_X + 72, y: PAGE_H - MARGIN_TOP - 22,
    size: 8, font, color: C_MUTED,
  })

  // Fecha emisión a la derecha
  const fechaLabel = wa('FECHA DE EMISIÓN')
  const fechaVal = wa(informe.fecha_emision)
  const fLabelW = bold.widthOfTextAtSize(fechaLabel, 7)
  const fValW = bold.widthOfTextAtSize(fechaVal, 10)
  page.drawText(fechaLabel, {
    x: PAGE_W - MARGIN_X - fLabelW, y: PAGE_H - MARGIN_TOP - 10,
    size: 7, font: bold, color: C_MUTED,
  })
  page.drawText(fechaVal, {
    x: PAGE_W - MARGIN_X - fValW, y: PAGE_H - MARGIN_TOP - 22,
    size: 10, font: bold, color: C_INK,
  })

  let y = PAGE_H - MARGIN_TOP - 52

  // Título
  page.drawText(wa('INFORME DE FACTURACIÓN'), {
    x: MARGIN_X, y,
    size: 15, font: bold, color: C_INK,
  })
  y -= 5
  page.drawRectangle({
    x: MARGIN_X, y: y - 2, width: 36, height: 2,
    color: C_ACCENT,
  })
  y -= 18

  // Dos columnas: EMITIDO POR | DIRIGIDO A (compactas)
  const colW = (CONTENT_W - 20) / 2
  const colA = MARGIN_X
  const colB = MARGIN_X + colW + 20
  page.drawText(wa('EMITIDO POR'), {
    x: colA, y, size: 7, font: bold, color: C_MUTED,
  })
  page.drawText(wa('DIRIGIDO A'), {
    x: colB, y, size: 7, font: bold, color: C_ACCENT,
  })
  y -= 10
  const emisorLineas = [
    'Alma Animal · Crematorio para mascotas',
    'contacto@crematorioalmaanimal.cl',
    'Santiago, Chile',
  ]
  let yE = y
  for (const l of emisorLineas) {
    page.drawText(wa(l), { x: colA, y: yE, size: 8, font, color: C_TXT })
    yE -= 10
  }
  const destLineas = [
    informe.veterinaria.nombre,
    informe.veterinaria.razon_social,
    informe.veterinaria.rut ? `RUT: ${informe.veterinaria.rut}` : '',
    [informe.veterinaria.direccion, informe.veterinaria.comuna].filter(Boolean).join(', '),
    [informe.veterinaria.nombre_contacto, informe.veterinaria.telefono].filter(Boolean).join(' · '),
    informe.veterinaria.correo,
  ].filter(Boolean)
  let yD = y
  for (let i = 0; i < destLineas.length; i++) {
    page.drawText(wa(destLineas[i]), {
      x: colB, y: yD,
      size: i === 0 ? 9 : 8,
      font: i === 0 ? bold : font,
      color: i === 0 ? C_INK : C_TXT,
    })
    yD -= i === 0 ? 11 : 10
  }
  y = Math.min(yE, yD) - 10

  // Período: chip horizontal compacto, sin total
  const blockH = 24
  page.drawRectangle({
    x: MARGIN_X, y: y - blockH, width: CONTENT_W, height: blockH,
    color: C_ACCENT_SOFT,
    borderColor: C_ACCENT,
    borderWidth: 0.5,
  })
  const desde = informe.rango.desde ?? '—'
  page.drawText(wa('PERÍODO:'), {
    x: MARGIN_X + 12, y: y - 16, size: 8, font: bold, color: C_ACCENT,
  })
  page.drawText(wa(`${desde}  a  ${informe.rango.hasta}`), {
    x: MARGIN_X + 60, y: y - 16, size: 10, font: bold, color: C_INK,
  })
  const fichasTxt = wa(`${informe.totales_generales.total_fichas} ficha${informe.totales_generales.total_fichas !== 1 ? 's' : ''} · ${informe.totales_generales.cantidad_meses} mes${informe.totales_generales.cantidad_meses !== 1 ? 'es' : ''}`)
  const fW = font.widthOfTextAtSize(fichasTxt, 9)
  page.drawText(fichasTxt, {
    x: PAGE_W - MARGIN_X - 12 - fW, y: y - 16, size: 9, font, color: C_TXT,
  })
  y -= blockH + 10

  ctx.y = y
}

function drawTituloMes(ctx: RenderCtx, label: string): void {
  ensureSpace(ctx, 22)
  ctx.page.drawText(wa(label.toUpperCase()), {
    x: MARGIN_X, y: ctx.y - 10,
    size: 11, font: ctx.bold, color: C_INK,
  })
  ctx.page.drawRectangle({
    x: MARGIN_X, y: ctx.y - 14, width: 30, height: 1.5,
    color: C_ACCENT,
  })
  ctx.y -= 18
}

function drawTituloSemana(ctx: RenderCtx, label: string): void {
  ensureSpace(ctx, 12)
  ctx.page.drawText(wa(label), {
    x: MARGIN_X, y: ctx.y - 8,
    size: 8, font: ctx.bold, color: C_ACCENT,
  })
  ctx.y -= 11
}

// Tabla limpia: Código · Fecha · Mascota · Serv · Estado · Adicionales · Total
const COLS = [
  { key: 'codigo',            w: 55, label: 'Código',     align: 'l' as const },
  { key: 'fecha_label',       w: 68, label: 'Fecha',      align: 'l' as const },
  { key: 'mascota',           w: 110, label: 'Mascota',   align: 'l' as const },
  { key: 'codigo_servicio',   w: 42, label: 'Serv.',      align: 'c' as const },
  { key: 'estado',            w: 62, label: 'Estado',     align: 'l' as const },
  { key: 'adicionales_label', w: 80, label: 'Adicionales', align: 'l' as const },
  { key: 'precio_total',      w: 82, label: 'Total',      align: 'r' as const, money: true },
]
const TABLE_W = COLS.reduce((s, c) => s + c.w, 0)
const TABLE_X = MARGIN_X + Math.max(0, (CONTENT_W - TABLE_W) / 2)

function drawTableHeader(ctx: RenderCtx): void {
  ensureSpace(ctx, 16)
  const h = 14
  ctx.page.drawRectangle({
    x: TABLE_X, y: ctx.y - h, width: TABLE_W, height: h,
    color: C_BG_SOFT,
  })
  ctx.page.drawLine({
    start: { x: TABLE_X, y: ctx.y },
    end: { x: TABLE_X + TABLE_W, y: ctx.y },
    thickness: 0.5, color: C_LINE_DARK,
  })
  ctx.page.drawLine({
    start: { x: TABLE_X, y: ctx.y - h },
    end: { x: TABLE_X + TABLE_W, y: ctx.y - h },
    thickness: 0.3, color: C_LINE,
  })
  let x = TABLE_X
  for (const col of COLS) {
    const label = wa(col.label.toUpperCase())
    const labelW = ctx.bold.widthOfTextAtSize(label, 6.5)
    const tx = col.align === 'r' ? x + col.w - labelW - 6
            : col.align === 'c' ? x + (col.w - labelW) / 2
            : x + 6
    ctx.page.drawText(label, {
      x: tx, y: ctx.y - h + 5,
      size: 6.5, font: ctx.bold, color: C_MUTED,
    })
    x += col.w
  }
  ctx.y -= h
}

function truncate(font: PDFFont, txt: string, max: number, size = 9): string {
  let s = wa(txt)
  if (font.widthOfTextAtSize(s, size) <= max) return s
  while (s.length > 0 && font.widthOfTextAtSize(s + '...', size) > max) s = s.slice(0, -1)
  return s + '...'
}

type RowData = Record<string, string | number>

function drawRow(ctx: RenderCtx, row: RowData): void {
  ensureSpace(ctx, 13)
  const h = 12
  let x = TABLE_X
  for (const col of COLS) {
    let raw = row[col.key]
    let text: string
    if (col.money) {
      text = wa(fmtCLP(Number(raw) || 0))
    } else {
      raw = (raw ?? '').toString()
      text = raw === '' ? '—' : truncate(ctx.font, raw, col.w - 12, 8)
    }
    const tw = ctx.font.widthOfTextAtSize(text, 8)
    const tx = col.align === 'r' ? x + col.w - tw - 6
            : col.align === 'c' ? x + (col.w - tw) / 2
            : x + 6
    ctx.page.drawText(text, {
      x: tx, y: ctx.y - h + 4,
      size: 8,
      font: col.money ? ctx.bold : ctx.font,
      color: col.money ? C_INK : C_TXT,
    })
    x += col.w
  }
  ctx.page.drawLine({
    start: { x: TABLE_X, y: ctx.y - h },
    end: { x: TABLE_X + TABLE_W, y: ctx.y - h },
    thickness: 0.2, color: C_LINE,
  })
  ctx.y -= h
}

function drawSubtotalSemana(ctx: RenderCtx, label: string, monto: number): void {
  ensureSpace(ctx, 16)
  const h = 14
  ctx.page.drawLine({
    start: { x: TABLE_X, y: ctx.y },
    end: { x: TABLE_X + TABLE_W, y: ctx.y },
    thickness: 0.4, color: C_LINE_DARK,
  })
  ctx.page.drawText(wa(`Subtotal ${label}`), {
    x: TABLE_X + 6, y: ctx.y - h + 4,
    size: 8, font: ctx.font, color: C_MUTED,
  })
  const txt = wa(fmtCLP(monto))
  const tw = ctx.bold.widthOfTextAtSize(txt, 9)
  ctx.page.drawText(txt, {
    x: TABLE_X + TABLE_W - tw - 6, y: ctx.y - h + 4,
    size: 9, font: ctx.bold, color: C_INK,
  })
  ctx.y -= h + 2
}

function drawTotalMes(ctx: RenderCtx, mesLabel: string, fichas: number, total: number): void {
  // Total mes compacto en una sola línea, sin contador de fichas debajo
  void fichas
  ensureSpace(ctx, 16)
  const h = 14
  ctx.page.drawRectangle({
    x: TABLE_X, y: ctx.y - h, width: TABLE_W, height: h,
    color: C_ACCENT_SOFT,
  })
  ctx.page.drawRectangle({
    x: TABLE_X, y: ctx.y - h, width: 2, height: h,
    color: C_ACCENT,
  })
  ctx.page.drawText(wa(`Total ${mesLabel}`), {
    x: TABLE_X + 10, y: ctx.y - h + 4,
    size: 9, font: ctx.bold, color: C_INK,
  })
  const txt = wa(fmtCLP(total))
  const tw = ctx.bold.widthOfTextAtSize(txt, 10)
  ctx.page.drawText(txt, {
    x: TABLE_X + TABLE_W - tw - 10, y: ctx.y - h + 4,
    size: 10, font: ctx.bold, color: C_ACCENT,
  })
  // Más espacio antes del próximo mes
  ctx.y -= h + 24
}

/**
 * Sección de resumen con barra horizontal que visualiza el porcentaje.
 * En lugar de mostrar monto, mostramos: Concepto | Cantidad | barra visual | %.
 * La barra ocupa el espacio de la columna y se rellena en C_ACCENT proporcional al %.
 */
function drawResumenSection(ctx: RenderCtx, titulo: string, rows: Array<{ etiqueta: string; count: number }>): void {
  const totalCount = rows.reduce((s, r) => s + r.count, 0)
  if (totalCount === 0) return

  ensureSpace(ctx, 22 + rows.length * 12)
  ctx.page.drawText(wa(titulo.toUpperCase()), {
    x: MARGIN_X, y: ctx.y - 8,
    size: 7, font: ctx.bold, color: C_MUTED,
  })
  ctx.y -= 13

  const tableX = MARGIN_X
  // Columnas: Concepto | Cantidad | Barra (gráfico) | %
  const widths = [
    Math.floor(CONTENT_W * 0.32),  // Concepto
    Math.floor(CONTENT_W * 0.10),  // Cantidad
    Math.floor(CONTENT_W * 0.46),  // Barra
    Math.floor(CONTENT_W * 0.12),  // %
  ]
  const tableW = widths.reduce((s, w) => s + w, 0)

  const headerH = 12
  ctx.page.drawLine({
    start: { x: tableX, y: ctx.y },
    end: { x: tableX + tableW, y: ctx.y },
    thickness: 0.4, color: C_LINE_DARK,
  })
  ctx.page.drawLine({
    start: { x: tableX, y: ctx.y - headerH },
    end: { x: tableX + tableW, y: ctx.y - headerH },
    thickness: 0.2, color: C_LINE,
  })
  const headers = ['Concepto', 'Cant.', 'Distribución', '%']
  let xH = tableX
  for (let i = 0; i < headers.length; i++) {
    const align = i === 0 || i === 2 ? 'l' : i === 1 ? 'c' : 'r'
    const txt = wa(headers[i].toUpperCase())
    const lw = ctx.bold.widthOfTextAtSize(txt, 6.5)
    const lx = align === 'r' ? xH + widths[i] - lw - 6
            : align === 'c' ? xH + (widths[i] - lw) / 2
            : xH + 6
    ctx.page.drawText(txt, {
      x: lx, y: ctx.y - 9, size: 6.5, font: ctx.bold, color: C_MUTED,
    })
    xH += widths[i]
  }
  ctx.y -= headerH

  for (const r of rows) {
    ensureSpace(ctx, 12)
    const pct = totalCount > 0 ? (r.count / totalCount) * 100 : 0
    const pctLabel = pct >= 10 ? pct.toFixed(0) + '%' : pct.toFixed(1) + '%'

    let xC = tableX
    // Col 0: Concepto
    const concepto = truncate(ctx.font, r.etiqueta, widths[0] - 12, 8)
    ctx.page.drawText(concepto, {
      x: xC + 6, y: ctx.y - 9,
      size: 8, font: ctx.font, color: C_TXT,
    })
    xC += widths[0]
    // Col 1: Cantidad (centrada)
    const cantTxt = String(r.count)
    const cantW = ctx.font.widthOfTextAtSize(cantTxt, 8)
    ctx.page.drawText(cantTxt, {
      x: xC + (widths[1] - cantW) / 2, y: ctx.y - 9,
      size: 8, font: ctx.font, color: C_TXT,
    })
    xC += widths[1]
    // Col 2: Barra horizontal
    const barAreaW = widths[2] - 12  // padding 6 cada lado
    const barH = 5
    const barY = ctx.y - 8 - barH / 2
    // Track de fondo
    ctx.page.drawRectangle({
      x: xC + 6, y: barY, width: barAreaW, height: barH,
      color: C_LINE,
    })
    // Fill
    const fillW = Math.max(1, Math.round(barAreaW * pct / 100))
    ctx.page.drawRectangle({
      x: xC + 6, y: barY, width: fillW, height: barH,
      color: C_ACCENT,
    })
    xC += widths[2]
    // Col 3: %
    const pctW = ctx.bold.widthOfTextAtSize(pctLabel, 8)
    ctx.page.drawText(pctLabel, {
      x: xC + widths[3] - pctW - 6, y: ctx.y - 9,
      size: 8, font: ctx.bold, color: C_INK,
    })

    ctx.page.drawLine({
      start: { x: tableX, y: ctx.y - 12 },
      end: { x: tableX + tableW, y: ctx.y - 12 },
      thickness: 0.15, color: C_LINE,
    })
    ctx.y -= 12
  }
  ctx.y -= 10
}

async function generarPDFInforme(informe: InformeVeterinaria): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const logoBytes = await loadLogo()
  const logoImg = logoBytes ? await pdf.embedPng(logoBytes).catch(() => null) : null

  const firstPage = pdf.addPage([PAGE_W, PAGE_H])
  const ctx: RenderCtx = {
    pdf, page: firstPage, font, bold,
    y: PAGE_H - MARGIN_TOP,
    logoImg: logoImg ?? null,
    informe,
    pageNum: 1,
  }

  // Página 1: portada formal (sin drawHeader compacto, ya tiene su propio header grande)
  drawPortada(ctx)

  // Cuerpo: por mes
  for (const mes of informe.meses) {
    drawTituloMes(ctx, mes.mes_label)
    for (const sem of mes.semanas) {
      if (sem.fichas.length === 0) continue
      drawTituloSemana(ctx, sem.semana_label)
      drawTableHeader(ctx)
      for (const f of sem.fichas) {
        drawRow(ctx, f as unknown as RowData)
      }
      drawSubtotalSemana(ctx, sem.semana_label, sem.subtotal)
    }
    drawTotalMes(ctx, mes.mes_label, mes.total_fichas, mes.total_mes)
  }

  // Resumen histórico (acumulado) con barras visuales de distribución
  ctx.y -= 6
  ensureSpace(ctx, 40)
  ctx.page.drawText(wa('RESUMEN HISTÓRICO'), {
    x: MARGIN_X, y: ctx.y - 10,
    size: 10, font: bold, color: C_INK,
  })
  ctx.page.drawRectangle({
    x: MARGIN_X, y: ctx.y - 14, width: 30, height: 1.5, color: C_ACCENT,
  })
  ctx.y -= 22

  drawResumenSection(ctx, 'Por especie',
    informe.resumen.por_especie.map(r => ({ etiqueta: r.especie, count: r.count })))
  drawResumenSection(ctx, 'Por tramo de peso',
    informe.resumen.por_peso.map(r => ({ etiqueta: r.rango, count: r.count })))
  drawResumenSection(ctx, 'Por tipo de servicio',
    informe.resumen.por_servicio.map(r => ({ etiqueta: r.codigo, count: r.count })))

  // Notita final (sin total general — se factura mes a mes)
  ensureSpace(ctx, 18)
  ctx.page.drawText(wa('La facturación se realiza mes a mes. Ver el total de cada mes en la sección correspondiente.'), {
    x: MARGIN_X, y: ctx.y - 8,
    size: 7.5, font, color: C_FAINT,
  })
  ctx.page.drawText(wa('Consultas: contacto@crematorioalmaanimal.cl'), {
    x: MARGIN_X, y: ctx.y - 18,
    size: 7.5, font, color: C_FAINT,
  })
  ctx.y -= 24

  drawFooter(ctx)

  const bytes = await pdf.save()
  return Buffer.from(bytes)
}

async function calcularVersion(vetId: string): Promise<number> {
  try {
    await ensureSheet('informes_veterinaria')
    await ensureColumns('informes_veterinaria', INFORMES_COLS)
    const rows = await getSheetData('informes_veterinaria')
    const propios = rows.filter(r => r.veterinaria_id === vetId)
    return propios.length + 1
  } catch {
    return 1
  }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    const role = (session?.user as { role?: string })?.role
    if (!esAdmin(role)) {
      return NextResponse.json({ error: 'Solo administradores pueden generar informes' }, { status: 403 })
    }

    const { id } = await params
    const informe = await generarInformeVeterinaria(id)
    if (informe.totales_generales.total_fichas === 0) {
      return NextResponse.json({ error: 'Esta veterinaria aún no tiene fichas para facturar (mes cerrado)' }, { status: 400 })
    }

    const buffer = await generarPDFInforme(informe)

    const safeName = (informe.veterinaria.nombre || `vet${id}`).replace(/[^a-zA-Z0-9_-]+/g, '_')
    const version = await calcularVersion(id)
    const filename = `Informe_${safeName}_v${version}.pdf`
    const key = `informes-veterinaria/${id}/${filename}`
    const upload = await uploadToR2(buffer, key, 'application/pdf').catch(err => {
      console.error('[informe/pdf] uploadToR2 falló:', err)
      return null
    })

    try {
      await ensureSheet('informes_veterinaria')
      await ensureColumns('informes_veterinaria', INFORMES_COLS)
      const informeId = await getNextId('informes_veterinaria')
      const now = new Date()
      const hh = String(now.getHours()).padStart(2, '0')
      const mm = String(now.getMinutes()).padStart(2, '0')
      await appendRow('informes_veterinaria', {
        id: informeId,
        veterinaria_id: id,
        veterinaria_nombre: informe.veterinaria.nombre,
        version,
        formato: 'pdf',
        periodo_hasta_mes: informe.rango.hasta.slice(0, 7),
        cantidad_meses: informe.totales_generales.cantidad_meses,
        cantidad_fichas: informe.totales_generales.total_fichas,
        monto_total_clp: informe.totales_generales.monto_total,
        fecha_emision: todayISO(),
        hora_emision: `${hh}:${mm}`,
        emitido_por_id: (session?.user as { id?: string })?.id ?? '',
        emitido_por_nombre: session?.user?.name || session?.user?.email || '',
        archivo_key: upload?.key ?? '',
        archivo_url: upload?.url ?? '',
        fecha_creacion: todayISO(),
      })
    } catch (err) {
      console.error('[informe/pdf] persistencia falló:', err)
    }

    return new Response(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string }
    return NextResponse.json({ error: err.message ?? String(e) }, { status: err.status ?? 500 })
  }
}
