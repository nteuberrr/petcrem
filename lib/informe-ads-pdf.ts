import { PDFDocument, PDFFont, PDFImage, PDFPage, RGB, rgb } from 'pdf-lib'
import { LETTER, C, embedBrandFonts, wrapText, fitText, type BrandFonts } from './pdf-brand'
import { LOGO_URL } from './email-layout'
import type { ResumenGoogleAds } from './google-ads'
import type { ResumenAds } from './meta-insights'
import type { Rentabilidad } from './marketing-rentabilidad'

/**
 * Informe de Publicidad (Google Ads + Meta) en PDF branded, al mismo estándar de
 * imprenta que el informe de facturación a veterinarias: banda navy en todas las
 * páginas, filete dorado, tarjetas KPI, gráfico evolutivo (gasto vs fichas),
 * tablas con grilla y un cierre de acciones recomendadas.
 */

export interface AdsAccion { prioridad: string; accion: string; motivo: string; esfuerzo: string }
export interface InformeAdsInput {
  desde: string; hasta: string
  contacto: { nombre: string; web: string }
  rent: Rentabilidad
  google: ResumenGoogleAds | null
  isPond: number | null
  meta: ResumenAds | null
  objCpa: number | null; objCpl: number | null
  /** Serie diaria (últimos ~30 días) — gasto total (Google+Meta) y fichas directas. */
  serie: { fecha: string; gasto: number; fichas: number }[]
  analisis: { resumen: string; lecturas: { titulo: string; detalle: string }[]; acciones: AdsAccion[] }
}

const { W: PAGE_W, H: PAGE_H } = LETTER
const MARGIN = 46
const CONTENT_W = PAGE_W - MARGIN * 2

const RED = rgb(0xB4 / 255, 0x23 / 255, 0x1d / 255)
const GREEN = rgb(0x1d / 255, 0x7a / 255, 0x4f / 255)
const AMBER = rgb(0xB6 / 255, 0x77 / 255, 0x2a / 255)

const clpFmt = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
const numFmt = new Intl.NumberFormat('es-CL')
const clp = (n: number | null | undefined) => n == null ? '—' : clpFmt.format(Math.round(n))
const nf = (n: number | null | undefined) => n == null ? '—' : numFmt.format(n)
const pc = (n: number | null | undefined, d = 1) => n == null ? '—' : `${n.toFixed(d)}%`
const dmy = (iso: string) => { const [y, m, dd] = iso.split('-'); return `${dd}/${m}/${y}` }
const dm = (iso: string) => { const [, m, dd] = iso.split('-'); return `${dd}/${m}` }

async function loadPng(doc: PDFDocument, url: string): Promise<PDFImage | null> {
  try { const r = await fetch(url); if (!r.ok) return null; return await doc.embedPng(new Uint8Array(await r.arrayBuffer())) } catch { return null }
}

export async function generarInformeAdsPdf(d: InformeAdsInput): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const f: BrandFonts = await embedBrandFonts(doc)
  const logo = await loadPng(doc, LOGO_URL)

  let page: PDFPage = null as unknown as PDFPage
  let y = 0
  let pageNo = 0

  const text = (s: string, x: number, yy: number, size: number, font: PDFFont, color: RGB) => page.drawText(s, { x, y: yy, size, font, color })
  const rightText = (s: string, rx: number, yy: number, size: number, font: PDFFont, color: RGB) => page.drawText(s, { x: rx - font.widthOfTextAtSize(s, size), y: yy, size, font, color })
  const centerText = (s: string, cx: number, yy: number, size: number, font: PDFFont, color: RGB) => page.drawText(s, { x: cx - font.widthOfTextAtSize(s, size) / 2, y: yy, size, font, color })

  function footer() {
    page.drawRectangle({ x: MARGIN, y: 40, width: CONTENT_W, height: 0.8, color: C.gold })
    text('Crematorio Alma Animal · Informe de Publicidad', MARGIN, 28, 8, f.regular, C.muted)
    rightText(`${d.contacto.web} · Página ${pageNo}`, PAGE_W - MARGIN, 28, 8, f.regular, C.muted)
  }
  function nuevaPagina(portada = false) {
    if (pageNo > 0) footer()
    page = doc.addPage([PAGE_W, PAGE_H])
    pageNo += 1
    const h = portada ? 118 : 44
    page.drawRectangle({ x: 0, y: PAGE_H - h, width: PAGE_W, height: h, color: C.navy })
    page.drawRectangle({ x: 0, y: PAGE_H - h - 3, width: PAGE_W, height: 3, color: C.gold })
    if (portada) {
      text('ALMA ANIMAL · MARKETING', MARGIN, PAGE_H - 40, 10, f.semibold, C.gold)
      text('Informe de Publicidad', MARGIN, PAGE_H - 72, 24, f.bold, C.white)
      text(`${dmy(d.desde)} — ${dmy(d.hasta)}  ·  Google Ads + Meta`, MARGIN, PAGE_H - 94, 10.5, f.regular, rgb(0.81, 0.86, 0.91))
    } else {
      text('CREMATORIO ALMA ANIMAL', MARGIN, PAGE_H - h / 2 + 2, 9.5, f.semibold, C.white)
      text('Informe de Publicidad', MARGIN, PAGE_H - h / 2 - 10, 7.5, f.regular, C.gold)
    }
    if (logo) {
      const lh = portada ? 60 : 26, lw = (logo.width / logo.height) * lh
      page.drawImage(logo, { x: PAGE_W - MARGIN - lw, y: PAGE_H - (portada ? 28 : h / 2 + lh / 2) - (portada ? lh : 0) + (portada ? 0 : 0), width: lw, height: lh })
    }
    y = PAGE_H - h - 26
  }
  const need = (h: number) => { if (y - h < 58) nuevaPagina() }
  const gap = (h: number) => { y -= h }

  function tituloSeccion(txt: string, sub?: string) {
    need((sub ? 40 : 30) + 40)
    gap(4)
    page.drawRectangle({ x: MARGIN, y: y - 2, width: 4, height: 17, color: C.gold })
    text(txt, MARGIN + 12, y, 14.5, f.bold, C.navy)
    gap(sub ? 16 : 12)
    page.drawRectangle({ x: MARGIN, y: y + 3, width: CONTENT_W, height: 0.7, color: C.line })
    if (sub) { gap(8); for (const ln of wrapText(sub, f.regular, 9.5, CONTENT_W)) { text(ln, MARGIN, y, 9.5, f.regular, C.muted); gap(12) } }
    gap(8)
  }

  // Fila de tarjetas KPI (4 por fila).
  function kpis(cards: { label: string; valor: string; sub?: string }[]) {
    const n = cards.length
    const gapX = 10
    const cw = (CONTENT_W - gapX * (n - 1)) / n
    const ch = 54
    need(ch + 8)
    const top = y
    cards.forEach((c, i) => {
      const x = MARGIN + i * (cw + gapX)
      page.drawRectangle({ x, y: top - ch, width: cw, height: ch, color: C.white, borderColor: C.line, borderWidth: 1 })
      page.drawRectangle({ x, y: top - ch, width: 3, height: ch, color: C.navy })
      text(c.label.toUpperCase(), x + 11, top - 15, 7.5, f.semibold, C.muted)
      text(fitText(c.valor, f.bold, 16, cw - 20), x + 11, top - 34, 16, f.bold, C.navy)
      if (c.sub) text(fitText(c.sub, f.regular, 8, cw - 20), x + 11, top - 46, 8, f.regular, C.muted)
    })
    gap(ch + 12)
  }

  // Gráfico evolutivo combo: barras = gasto, línea = fichas.
  function evolucion() {
    const serie = d.serie
    if (serie.length < 2) return
    const H = 164
    need(H + 30)
    const x0 = MARGIN, w = CONTENT_W
    const padL = 46, padR = 40, padT = 22, padB = 38
    const plotX = x0 + padL, plotW = w - padL - padR
    const plotTop = y - padT, plotH = H - padT - padB, plotBot = plotTop - plotH
    const maxG = Math.max(1, ...serie.map(p => p.gasto))
    const maxF = Math.max(1, ...serie.map(p => p.fichas))
    // Marco + gridlines
    page.drawRectangle({ x: x0, y: y - H, width: w, height: H, color: C.white, borderColor: C.line, borderWidth: 1 })
    for (let g = 0; g <= 3; g++) {
      const gy = plotBot + (plotH * g) / 3
      page.drawLine({ start: { x: plotX, y: gy }, end: { x: plotX + plotW, y: gy }, thickness: 0.5, color: C.lineSoft })
      rightText(`$${Math.round((maxG * g / 3) / 1000)}k`, plotX - 6, gy - 3, 7, f.regular, C.muted)
      text(String(Math.round(maxF * g / 3)), plotX + plotW + 6, gy - 3, 7, f.regular, AMBER)
    }
    // Barras (gasto)
    const step = plotW / serie.length
    const bw = Math.max(2, step * 0.62)
    serie.forEach((p, i) => {
      const bh = (p.gasto / maxG) * plotH
      const bx = plotX + i * step + (step - bw) / 2
      if (bh > 0) page.drawRectangle({ x: bx, y: plotBot, width: bw, height: bh, color: C.navy })
    })
    // Línea (fichas)
    const cx = (i: number) => plotX + i * step + step / 2
    const cy = (v: number) => plotBot + (v / maxF) * plotH
    for (let i = 1; i < serie.length; i++) {
      page.drawLine({ start: { x: cx(i - 1), y: cy(serie[i - 1].fichas) }, end: { x: cx(i), y: cy(serie[i].fichas) }, thickness: 1.6, color: C.gold })
    }
    serie.forEach((p, i) => { if (p.fichas > 0) page.drawCircle({ x: cx(i), y: cy(p.fichas), size: 2, color: C.gold }) })
    // Etiquetas X (cada ~6)
    const cadaX = Math.ceil(serie.length / 7)
    serie.forEach((p, i) => { if (i % cadaX === 0) centerText(dm(p.fecha), cx(i), plotBot - 12, 6.5, f.regular, C.muted) })
    // Leyenda (bajo las fechas, sin encimarse)
    const ly = y - H + 6
    page.drawRectangle({ x: plotX, y: ly, width: 9, height: 7, color: C.navy })
    text('Gasto diario', plotX + 13, ly, 7.5, f.regular, C.ink)
    const lx2 = plotX + 90
    page.drawLine({ start: { x: lx2, y: ly + 3 }, end: { x: lx2 + 12, y: ly + 3 }, thickness: 1.6, color: C.gold })
    text('Fichas directas', lx2 + 16, ly, 7.5, f.regular, C.ink)
    gap(H + 14)
  }

  // Tabla genérica con grilla.
  function tabla(headers: { t: string; w: number; a?: 'l' | 'r' }[], rows: string[][], colColor?: (ri: number, ci: number, v: string) => RGB | undefined) {
    const hh = 20, rh = 17
    const drawHead = () => {
      need(hh + rh)
      let x = MARGIN
      page.drawRectangle({ x: MARGIN, y: y - hh, width: CONTENT_W, height: hh, color: C.navy })
      headers.forEach(h => {
        if (h.a === 'r') rightText(h.t, x + h.w - 6, y - hh + 6.5, 7.5, f.semibold, C.white)
        else text(h.t, x + 6, y - hh + 6.5, 7.5, f.semibold, C.white)
        x += h.w
      })
      gap(hh)
    }
    drawHead()
    let zebra = false
    rows.forEach((r, ri) => {
      if (y - rh < 58) { nuevaPagina(); drawHead(); zebra = false }
      if (zebra) page.drawRectangle({ x: MARGIN, y: y - rh, width: CONTENT_W, height: rh, color: C.zebra })
      let x = MARGIN
      headers.forEach((h, ci) => {
        const v = r[ci] ?? ''
        const col = colColor?.(ri, ci, v) || C.ink
        const font = ci === 0 ? f.semibold : f.regular
        if (h.a === 'r') rightText(v, x + h.w - 6, y - rh + 5.5, 8, font, col)
        else text(fitText(v, font, 8, h.w - 8), x + 6, y - rh + 5.5, 8, font, col)
        x += h.w
      })
      page.drawLine({ start: { x: MARGIN, y: y - rh }, end: { x: MARGIN + CONTENT_W, y: y - rh }, thickness: 0.4, color: C.line })
      gap(rh); zebra = !zebra
    })
    gap(6)
  }

  function acciones(acc: AdsAccion[]) {
    const colP: Record<string, RGB> = { Alta: RED, Media: AMBER, Baja: GREEN }
    acc.forEach((a, i) => {
      const motivoLns = wrapText(a.motivo, f.regular, 8.5, CONTENT_W - 24)
      const ch = 30 + motivoLns.length * 11
      need(ch + 8)
      const top = y
      page.drawRectangle({ x: MARGIN, y: top - ch, width: CONTENT_W, height: ch, color: C.white, borderColor: C.line, borderWidth: 1 })
      page.drawRectangle({ x: MARGIN, y: top - ch, width: 4, height: ch, color: colP[a.prioridad] || C.navy })
      text(`${i + 1}. PRIORIDAD ${a.prioridad.toUpperCase()} · ESFUERZO ${a.esfuerzo.toUpperCase()}`, MARGIN + 14, top - 14, 7.5, f.semibold, colP[a.prioridad] || C.navy)
      text(fitText(a.accion, f.bold, 11, CONTENT_W - 28), MARGIN + 14, top - 28, 11, f.bold, C.navy)
      let yy = top - 40
      for (const ln of motivoLns) { text(ln, MARGIN + 14, yy, 8.5, f.regular, C.muted); yy -= 11 }
      gap(ch + 8)
    })
  }

  // ───────────────────────── Documento ─────────────────────────
  nuevaPagina(true)
  const r = d.rent

  // 1. Resumen ejecutivo
  tituloSeccion('Resumen ejecutivo', `${dmy(d.desde)} – ${dmy(d.hasta)} · rentabilidad blended (gasto vs fichas e ingresos reales)`)
  kpis([
    { label: 'Gasto total', valor: clp(r.gastoTotal), sub: `Google ${clp(r.gastoGoogle)} · Meta ${clp(r.gastoMeta)}` },
    { label: 'Fichas directas', valor: String(r.fichasDirectas), sub: `+${r.fichasConvenio} de convenio` },
    { label: 'Ingresos directos', valor: clp(r.ingresosDirectos), sub: `ticket ${clp(r.ticketPromedio)}` },
    { label: 'ROAS blended', valor: r.roasBlended == null ? '—' : `${r.roasBlended}x`, sub: `CPA real ${clp(r.cpaReal)}` },
  ])
  if (d.analisis.resumen) {
    const lns = wrapText(d.analisis.resumen, f.regular, 10, CONTENT_W - 28)
    const bh = 16 + lns.length * 13
    need(bh + 6)
    page.drawRectangle({ x: MARGIN, y: y - bh, width: CONTENT_W, height: bh, color: C.cream, borderColor: C.line, borderWidth: 1 })
    let yy = y - 16
    for (const ln of lns) { text(ln, MARGIN + 14, yy, 10, f.regular, C.ink); yy -= 13 }
    gap(bh + 12)
  }

  // 2. Evolución
  tituloSeccion('Evolución', '¿Estamos mejorando o empeorando? Gasto diario vs fichas directas captadas.')
  evolucion()

  // 3. Google Ads
  if (d.google) {
    const g = d.google, gc = g.cuenta
    tituloSeccion('Google Ads', `Impression share ponderado ${pc(d.isPond)} — presencia en las subastas vs la competencia`)
    kpis([
      { label: 'Gasto', valor: clp(gc.gasto), sub: g.comparacion ? `vs ${g.comparacion.etiqueta}` : '' },
      { label: 'Clicks', valor: nf(gc.clicks), sub: `CTR ${pc(gc.ctr)} · CPC ${clp(gc.cpc)}` },
      { label: 'Conversiones', valor: String(gc.conversiones), sub: `CPA ${clp(gc.costoPorConversion)}` },
      { label: 'Imp. Share', valor: pc(d.isPond), sub: 'cuota vs mercado' },
    ])
    const rows = g.campanas.filter(c => c.gasto > 0 || c.impresiones > 0).map(c => [
      c.nombre, clp(c.gasto), nf(c.clicks), pc(c.ctr), clp(c.cpc), String(c.conversiones), c.costoPorConversion ? clp(c.costoPorConversion) : '—', pc(c.impressionShare), pc(c.perdidoPorPresupuesto), pc(c.perdidoPorRanking),
    ])
    const cw = CONTENT_W
    tabla([
      { t: 'Campaña', w: cw * 0.24 }, { t: 'Gasto', w: cw * 0.1, a: 'r' }, { t: 'Clicks', w: cw * 0.08, a: 'r' },
      { t: 'CTR', w: cw * 0.07, a: 'r' }, { t: 'CPC', w: cw * 0.09, a: 'r' }, { t: 'Conv', w: cw * 0.07, a: 'r' },
      { t: 'CPA', w: cw * 0.1, a: 'r' }, { t: 'Imp.Sh', w: cw * 0.08, a: 'r' }, { t: 'Perd$', w: cw * 0.05, a: 'r' }, { t: 'PerdR', w: cw * 0.05, a: 'r' },
    ], rows, (ri, ci, v) => {
      if (ci === 8 && parseFloat(v) >= 15) return RED   // perdido por presupuesto alto
      return undefined
    })
    text('Imp.Sh = cuota de impresiones · Perd$ = impresiones perdidas por presupuesto · PerdR = perdidas por ranking (calidad/puja).', MARGIN, y, 7.5, f.regular, C.muted); gap(14)
  } else {
    tituloSeccion('Google Ads', 'No configurado o sin datos en el período.')
  }

  // 4. Meta Ads
  const mConGasto = d.meta && d.meta.cuenta.spend > 0
  if (d.meta && mConGasto) {
    const m = d.meta, mc = m.cuenta
    tituloSeccion('Meta Ads (Facebook / Instagram)')
    kpis([
      { label: 'Gasto', valor: clp(mc.spend) },
      { label: 'Alcance', valor: nf(mc.alcance), sub: `${nf(mc.impresiones)} impresiones` },
      { label: 'Clicks', valor: nf(mc.clicks), sub: `CTR ${pc(mc.ctr)}` },
      { label: 'CPC', valor: clp(Math.round(mc.cpc)) },
    ])
    const rows = m.campanas.filter(c => c.spend > 0).slice(0, 12).map(c => [
      c.nombre, clp(c.spend), nf(c.impresiones), nf(c.alcance), nf(c.clicks), pc(c.ctr), clp(Math.round(c.cpc)),
    ])
    const cw = CONTENT_W
    tabla([
      { t: 'Campaña', w: cw * 0.34 }, { t: 'Gasto', w: cw * 0.12, a: 'r' }, { t: 'Impr.', w: cw * 0.12, a: 'r' },
      { t: 'Alcance', w: cw * 0.12, a: 'r' }, { t: 'Clicks', w: cw * 0.1, a: 'r' }, { t: 'CTR', w: cw * 0.1, a: 'r' }, { t: 'CPC', w: cw * 0.1, a: 'r' },
    ], rows)
  } else {
    tituloSeccion('Meta Ads (Facebook / Instagram)', d.meta ? 'Sin inversión en Meta durante el período — canal disponible sin explotar.' : 'No configurado.')
  }

  // 5. Rentabilidad real
  tituloSeccion('Rentabilidad real', 'Gasto en ads cruzado con resultados del sistema — atribución blended, aproximada')
  kpis([
    { label: 'Leads WhatsApp', valor: r.leadsWhatsapp == null ? 's/d' : String(r.leadsWhatsapp), sub: 'conversaciones nuevas' },
    { label: 'Tasa de cierre', valor: r.tasaCierrePct == null ? 's/d' : `${r.tasaCierrePct}%`, sub: 'fichas / leads' },
    { label: 'CPL real', valor: clp(r.cplReal), sub: d.objCpl ? `objetivo ${clp(d.objCpl)}` : '' },
    { label: 'CPA real', valor: clp(r.cpaReal), sub: d.objCpa ? `objetivo ${clp(d.objCpa)}` : '' },
  ])

  // 6. Lecturas
  if (d.analisis.lecturas?.length) {
    tituloSeccion('Lecturas del período')
    for (const l of d.analisis.lecturas) {
      const lns = wrapText(`${l.titulo}: ${l.detalle}`, f.regular, 9.5, CONTENT_W - 16)
      need(lns.length * 12 + 6)
      page.drawCircle({ x: MARGIN + 3, y: y + 3, size: 2, color: C.gold })
      let yy = y
      lns.forEach((ln, k) => { text(ln, MARGIN + 12, yy, 9.5, k === 0 ? f.semibold : f.regular, k === 0 ? C.navy : C.ink); yy -= 12 })
      gap(lns.length * 12 + 4)
    }
    gap(4)
  }

  // 7. Acciones
  tituloSeccion('Acciones recomendadas', 'Ordenadas por prioridad — impacto en fichas e ingresos')
  acciones(d.analisis.acciones)

  if (r.avisos.length) { need(20); text(`Notas: ${r.avisos.join(' · ')}`, MARGIN, y, 7.5, f.regular, C.muted); gap(12) }

  footer()
  return Buffer.from(await doc.save())
}
