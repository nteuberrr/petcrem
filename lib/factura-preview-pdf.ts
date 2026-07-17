import { PDFDocument, rgb } from 'pdf-lib'
import { LETTER, C, embedBrandFonts, wrapText, fitText } from './pdf-brand'
import { desglosarIvaIncluido } from './openfactura'

/**
 * PDF de MUESTRA de una factura, con la marca Alma Animal. NO es el DTE oficial
 * del SII (ese lo genera Haulmer al emitir) — sirve para aprobar el FORMATO y ver
 * cómo se ven nuestros datos (emisor, receptor, líneas, neto/IVA/total). Reutiliza
 * el toolkit pdf-brand (Carta + Inter embebida). Lleva marca de agua/leyenda de
 * "documento de muestra, no válido tributariamente".
 */

const RED = rgb(0.72, 0.11, 0.11)

export interface FacturaPreviewEmisor {
  razonSocial: string
  rut: string
  giro: string
  direccion: string
  comuna: string
}
export interface FacturaPreviewReceptor {
  razonSocial: string
  rut: string
  giro?: string
  direccion?: string
  comuna?: string
  correo?: string
}
export interface FacturaPreviewLinea {
  nombre: string
  cantidad: number
  /** Precio unitario BRUTO (IVA incluido). */
  precioBruto: number
}
export interface FacturaPreviewOpts {
  emisor: FacturaPreviewEmisor
  receptor: FacturaPreviewReceptor
  lineas: FacturaPreviewLinea[]
  fecha: string        // DD/MM/YYYY (o lo que se quiera mostrar)
  folio?: string       // opcional; si no viene se muestra "(por asignar)"
}

function fmtCLP(n: number): string {
  return '$' + Math.round(n).toLocaleString('es-CL')
}

export async function generarFacturaPreviewPDF(o: FacturaPreviewOpts): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const f = await embedBrandFonts(doc)
  const page = doc.addPage([LETTER.W, LETTER.H])
  const M = 42
  const right = LETTER.W - M
  let y = LETTER.H - M

  const text = (s: string, x: number, yy: number, size: number, font = f.regular, color = C.ink) =>
    page.drawText(s, { x, y: yy, size, font, color })
  const textR = (s: string, xr: number, yy: number, size: number, font = f.regular, color = C.ink) =>
    page.drawText(s, { x: xr - font.widthOfTextAtSize(s, size), y: yy, size, font, color })

  // ── Encabezado: banda navy con el emisor + caja roja del RUT/factura ──────────
  const headH = 92
  page.drawRectangle({ x: M, y: y - headH, width: right - M, height: headH, color: C.navy })
  // Emisor (izquierda, blanco)
  text(fitText(o.emisor.razonSocial, f.bold, 16, 300), M + 16, y - 30, 16, f.bold, C.white)
  text(fitText(o.emisor.giro, f.regular, 9.5, 300), M + 16, y - 46, 9.5, f.regular, rgb(0.85, 0.89, 0.94))
  text(fitText(o.emisor.direccion + (o.emisor.comuna ? `, ${o.emisor.comuna}` : ''), f.regular, 9.5, 300), M + 16, y - 60, 9.5, f.regular, rgb(0.85, 0.89, 0.94))
  text('Santiago · Chile', M + 16, y - 74, 9.5, f.regular, rgb(0.85, 0.89, 0.94))
  // Caja roja (derecha)
  const boxW = 176, boxX = right - 16 - boxW
  page.drawRectangle({ x: boxX, y: y - 78, width: boxW, height: 60, borderColor: C.gold, borderWidth: 1.5, color: rgb(1, 1, 1) })
  const cx = boxX + boxW / 2
  const centerRed = (s: string, yy: number, size: number, font = f.bold) =>
    page.drawText(s, { x: cx - font.widthOfTextAtSize(s, size) / 2, y: yy, size, font, color: RED })
  centerRed(`R.U.T. ${o.emisor.rut}`, y - 34, 11)
  centerRed('FACTURA ELECTRÓNICA', y - 50, 10.5)
  centerRed(`N° ${o.folio || '(por asignar)'}`, y - 66, 10.5)

  y -= headH + 22

  // ── Fecha + Receptor ─────────────────────────────────────────────────────────
  text('Fecha de emisión:', M, y, 10, f.semibold, C.muted)
  text(o.fecha, M + 96, y, 10, f.regular)
  y -= 20

  page.drawRectangle({ x: M, y: y - 78, width: right - M, height: 78, borderColor: C.line, borderWidth: 1, color: C.cream })
  const rx = M + 14
  text('SEÑOR(ES)', rx, y - 16, 8.5, f.semibold, C.muted)
  text(fitText(o.receptor.razonSocial, f.bold, 12, right - M - 40), rx, y - 31, 12, f.bold, C.navy)
  const rline = (label: string, val: string, yy: number) => {
    text(label, rx, yy, 9, f.semibold, C.muted)
    text(fitText(val || '—', f.regular, 9, right - M - 120), rx + 62, yy, 9, f.regular)
  }
  rline('R.U.T.', o.receptor.rut, y - 46)
  rline('Giro', o.receptor.giro || '—', y - 58)
  rline('Dirección', [o.receptor.direccion, o.receptor.comuna].filter(Boolean).join(', ') || '—', y - 70)

  y -= 78 + 22

  // ── Tabla de detalle ─────────────────────────────────────────────────────────
  const colDet = M + 12
  const colCant = right - 232
  const colPrc = right - 128
  const colTot = right - 12
  page.drawRectangle({ x: M, y: y - 22, width: right - M, height: 22, color: C.navy })
  text('DETALLE', colDet, y - 15, 9, f.semibold, C.white)
  textR('CANT.', colCant + 30, y - 15, 9, f.semibold, C.white)
  textR('P. UNITARIO', colPrc + 4, y - 15, 9, f.semibold, C.white)
  textR('TOTAL', colTot, y - 15, 9, f.semibold, C.white)
  y -= 22

  let subtotalBruto = 0
  let zebra = false
  for (const l of o.lineas) {
    const totLinea = Math.round(l.precioBruto * l.cantidad)
    subtotalBruto += totLinea
    const lines = wrapText(l.nombre, f.regular, 9.5, colCant - colDet - 20)
    const rowH = Math.max(20, 6 + lines.length * 12)
    if (zebra) page.drawRectangle({ x: M, y: y - rowH, width: right - M, height: rowH, color: C.zebra })
    zebra = !zebra
    let ly = y - 14
    for (const ln of lines) { text(ln, colDet, ly, 9.5, f.regular); ly -= 12 }
    textR(String(l.cantidad), colCant + 30, y - 14, 9.5, f.regular)
    textR(fmtCLP(l.precioBruto), colPrc + 4, y - 14, 9.5, f.regular)
    textR(fmtCLP(totLinea), colTot, y - 14, 9.5, f.semibold)
    y -= rowH
    page.drawLine({ start: { x: M, y }, end: { x: right, y }, thickness: 0.5, color: C.lineSoft })
  }

  // ── Totales (IVA incluido en los brutos) ─────────────────────────────────────
  const { neto, iva, total } = desglosarIvaIncluido(subtotalBruto)
  y -= 16
  const tLabelX = right - 200, tValX = right
  const totRow = (label: string, val: string, yy: number, bold = false) => {
    text(label, tLabelX, yy, bold ? 11 : 10, bold ? f.bold : f.semibold, bold ? C.navy : C.muted)
    textR(val, tValX, yy, bold ? 12 : 10, bold ? f.bold : f.regular, bold ? C.navy : C.ink)
  }
  totRow('Monto Neto', fmtCLP(neto), y); y -= 16
  totRow('IVA (19%)', fmtCLP(iva), y); y -= 16
  page.drawLine({ start: { x: tLabelX, y: y + 6 }, end: { x: right, y: y + 6 }, thickness: 1, color: C.gold })
  y -= 6
  totRow('TOTAL', fmtCLP(total), y, true)

  // ── Pie: leyenda de muestra + timbre simulado ────────────────────────────────
  const footY = M + 44
  page.drawRectangle({ x: M, y: footY, width: right - M, height: 30, color: C.cream, borderColor: C.line, borderWidth: 1 })
  text('DOCUMENTO DE MUESTRA — vista de formato con datos reales.', M + 12, footY + 18, 9, f.semibold, RED)
  text('No es un DTE válido ante el SII (el timbre y folio se generan al emitir la factura real en Haulmer).', M + 12, footY + 7, 8, f.regular, C.muted)
  text('Timbre Electrónico SII — se genera al emitir', M, M + 4, 7.5, f.regular, C.muted)

  return doc.save()
}
