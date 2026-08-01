/**
 * Liquidación de sueldo en PDF, con la marca Alma Animal.
 *
 * Sigue la estructura del documento que emite el contador (encabezado del
 * empleador y del trabajador, haberes imponibles / no imponibles, descuentos,
 * líquido, monto en palabras y firma), sobre la base gráfica compartida de
 * lib/pdf-brand.ts.
 *
 * Se dibuja desde el SNAPSHOT guardado en la liquidación, no recalculando: una
 * liquidación de enero reimpresa en diciembre sale idéntica.
 */
import { PDFDocument, PDFPage, rgb } from 'pdf-lib'
import { C, LETTER, embedBrandFonts, fitText, type BrandFonts } from '@/lib/pdf-brand'
import { formatDate } from '@/lib/dates'
import type { Liquidacion, Linea } from './tipos'

const M = 48 // margen
const ANCHO = LETTER.W - M * 2

export interface DatosEmpleador {
  razon_social: string
  rut: string
  direccion: string
}

export interface DatosLiquidacionPdf {
  periodo: string
  periodoTexto: string
  empleador: DatosEmpleador
  trabajador: {
    nombre: string
    rut: string
    cargo: string
    unidad_negocio: string
    tipo_contrato: string
    fecha_ingreso: string
    fecha_termino: string
    sueldo_base: number
  }
  liquidacion: Liquidacion
}

const money = (n: number) => '$ ' + Math.round(n).toLocaleString('es-CL')

// ── Monto en palabras ───────────────────────────────────────────────────────
const UNIDADES = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ',
  'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE']
const DECENAS = ['', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA']
const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS',
  'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS']

function menosDeMil(n: number): string {
  if (n === 0) return ''
  if (n === 100) return 'CIEN'
  const c = Math.floor(n / 100)
  const resto = n % 100
  const partes: string[] = []
  if (c) partes.push(CENTENAS[c])
  if (resto < 20) { if (resto) partes.push(UNIDADES[resto]) }
  else {
    const d = Math.floor(resto / 10)
    const u = resto % 10
    if (d === 2 && u) partes.push(`VEINTI${UNIDADES[u].toLowerCase().toUpperCase()}`)
    else { partes.push(DECENAS[d]); if (u) partes.push(`Y ${UNIDADES[u]}`) }
  }
  return partes.join(' ')
}

/** "SEISCIENTOS DIECISÉIS MIL PESOS". */
export function montoEnPalabras(n: number): string {
  const entero = Math.abs(Math.round(n))
  if (entero === 0) return 'CERO PESOS'
  const millones = Math.floor(entero / 1_000_000)
  const miles = Math.floor((entero % 1_000_000) / 1000)
  const resto = entero % 1000
  const partes: string[] = []
  if (millones === 1) partes.push('UN MILLÓN')
  else if (millones > 1) partes.push(`${menosDeMil(millones)} MILLONES`)
  if (miles === 1) partes.push('MIL')
  else if (miles > 1) partes.push(`${menosDeMil(miles)} MIL`)
  if (resto) partes.push(menosDeMil(resto))
  return `${partes.join(' ')} PESOS`
}

// ── Dibujo ──────────────────────────────────────────────────────────────────

function texto(p: PDFPage, t: string, x: number, y: number, f: BrandFonts['regular'], size: number, color = C.ink) {
  p.drawText(t, { x, y, size, font: f, color })
}

function derecha(p: PDFPage, t: string, xDer: number, y: number, f: BrandFonts['regular'], size: number, color = C.ink) {
  p.drawText(t, { x: xDer - f.widthOfTextAtSize(t, size), y, size, font: f, color })
}

function regla(p: PDFPage, y: number, color = C.line) {
  p.drawRectangle({ x: M, y, width: ANCHO, height: 0.7, color })
}

export async function generarLiquidacionPdf(d: DatosLiquidacionPdf): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const fonts = await embedBrandFonts(doc)
  const page = doc.addPage([LETTER.W, LETTER.H])
  const { regular, semibold, bold } = fonts

  // ── Encabezado de marca ──────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: LETTER.H - 84, width: LETTER.W, height: 84, color: C.navy })
  texto(page, 'LIQUIDACIÓN DE SUELDO', M, LETTER.H - 44, bold, 17, C.white)
  texto(page, d.periodoTexto.toUpperCase(), M, LETTER.H - 63, semibold, 11, C.gold)
  derecha(page, d.empleador.razon_social.toUpperCase(), LETTER.W - M, LETTER.H - 44, semibold, 11, C.white)
  derecha(page, `RUT ${d.empleador.rut}`, LETTER.W - M, LETTER.H - 60, regular, 9, C.cream)
  derecha(page, d.empleador.direccion, LETTER.W - M, LETTER.H - 73, regular, 8, C.cream)
  page.drawRectangle({ x: 0, y: LETTER.H - 88, width: LETTER.W, height: 4, color: C.gold })

  let y = LETTER.H - 118

  // ── Datos del trabajador ─────────────────────────────────────────────────
  page.drawRectangle({ x: M, y: y - 62, width: ANCHO, height: 74, color: C.cream })
  const col2 = M + ANCHO / 2
  const par = (label: string, valor: string, x: number, yy: number) => {
    texto(page, label, x + 10, yy, regular, 8, C.muted)
    texto(page, fitText(valor || '—', semibold, 9.5, ANCHO / 2 - 100), x + 96, yy, semibold, 9.5)
  }
  par('Trabajador', d.trabajador.nombre, M, y)
  par('RUT', d.trabajador.rut, col2, y)
  par('Cargo', d.trabajador.cargo, M, y - 15)
  par('Sueldo base', money(d.trabajador.sueldo_base), col2, y - 15)
  par('Tipo de contrato', d.trabajador.tipo_contrato, M, y - 30)
  par('Unidad de negocio', d.trabajador.unidad_negocio, col2, y - 30)
  par('Fecha de ingreso', d.trabajador.fecha_ingreso ? formatDate(d.trabajador.fecha_ingreso) : '—', M, y - 45)
  par('Fecha de término', d.trabajador.fecha_termino ? formatDate(d.trabajador.fecha_termino) : '—', col2, y - 45)
  y -= 84

  const l = d.liquidacion

  // ── Haberes ──────────────────────────────────────────────────────────────
  y = seccion(page, fonts, 'HABERES', y)
  y = subtitulo(page, fonts, 'Imponibles', y)
  for (const li of l.haberes.imponibles) y = fila(page, fonts, li, y)
  y = total(page, fonts, 'TOTAL IMPONIBLE', l.totales.total_imponible, y)

  y = subtitulo(page, fonts, 'No imponibles', y)
  for (const li of l.haberes.no_imponibles) y = fila(page, fonts, li, y)
  y = total(page, fonts, 'TOTAL NO IMPONIBLE', l.totales.total_no_imponible, y)
  y = total(page, fonts, 'TOTAL HABERES', l.totales.total_haberes, y, true)

  // ── Descuentos ───────────────────────────────────────────────────────────
  y -= 10
  y = seccion(page, fonts, 'DESCUENTOS', y)
  for (const li of [...l.descuentos.legales, ...l.descuentos.otros]) y = fila(page, fonts, li, y)
  y = total(page, fonts, 'TOTAL DESCUENTOS', l.totales.total_descuentos, y, true)

  // ── Líquido ──────────────────────────────────────────────────────────────
  y -= 16
  page.drawRectangle({ x: M, y: y - 12, width: ANCHO, height: 34, color: C.navy })
  texto(page, 'LÍQUIDO A PAGO', M + 12, y + 2, bold, 12, C.white)
  derecha(page, money(l.totales.liquido), LETTER.W - M - 12, y, bold, 16, C.gold)
  y -= 28

  texto(page, `SON: ${montoEnPalabras(l.totales.liquido)}`, M, y, semibold, 8.5, C.muted)
  y -= 14
  texto(page, `Total tributable: ${money(l.totales.base_tributable)}`, M, y, regular, 8, C.muted)
  y -= 20

  // ── Reembolso de salud (fuera de la liquidación) ─────────────────────────
  if (l.totales.reembolso_salud > 0) {
    page.drawRectangle({ x: M, y: y - 44, width: ANCHO, height: 56, color: rgb(0.99, 0.96, 0.88) })
    page.drawRectangle({ x: M, y: y - 44, width: 3, height: 56, color: C.gold })
    texto(page, 'PAGO ADICIONAL — FUERA DE LA LIQUIDACIÓN', M + 12, y, semibold, 8.5, C.goldDeep)
    texto(page, 'El trabajador no está afiliado a un sistema previsional de salud, por lo que el 7%', M + 12, y - 14, regular, 8, C.muted)
    texto(page, 'se le entrega directamente.', M + 12, y - 24, regular, 8, C.muted)
    texto(page, 'Reembolso de salud', M + 12, y - 38, semibold, 9)
    derecha(page, money(l.totales.reembolso_salud), LETTER.W - M - 90, y - 38, semibold, 9)
    texto(page, 'Total a transferir', LETTER.W - M - 78, y - 38, bold, 9, C.navy)
    derecha(page, money(l.totales.total_a_transferir), LETTER.W - M - 12, y - 38, bold, 10, C.navy)
    y -= 62
  }

  // ── Firma ────────────────────────────────────────────────────────────────
  y = Math.min(y, 150)
  texto(page, 'Recibí conforme el alcance líquido de la presente liquidación, no teniendo cargo ni cobro', M, y, regular, 8, C.muted)
  texto(page, 'alguno que hacer por ningún concepto.', M, y - 10, regular, 8, C.muted)
  page.drawRectangle({ x: LETTER.W - M - 200, y: y - 52, width: 200, height: 0.8, color: C.ink })
  derecha(page, 'FIRMA DEL TRABAJADOR', LETTER.W - M - 40, y - 64, regular, 8, C.muted)

  // Pie
  page.drawRectangle({ x: 0, y: 0, width: LETTER.W, height: 22, color: C.cream })
  texto(page, `${d.empleador.razon_social} · Documento generado por Alma Animal Systems`, M, 8, regular, 7, C.muted)

  return Buffer.from(await doc.save())
}

function seccion(p: PDFPage, f: BrandFonts, titulo: string, y: number): number {
  texto(p, titulo, M, y, f.bold, 10, C.navy)
  regla(p, y - 5, C.navySoft)
  return y - 18
}

function subtitulo(p: PDFPage, f: BrandFonts, t: string, y: number): number {
  texto(p, t.toUpperCase(), M, y, f.semibold, 7.5, C.muted)
  return y - 12
}

function fila(p: PDFPage, f: BrandFonts, li: Linea, y: number): number {
  texto(p, fitText(li.etiqueta, f.regular, 9, 300), M + 8, y, f.regular, 9)
  if (li.formula) texto(p, fitText(li.formula, f.regular, 6.5, 260), M + 250, y, f.regular, 6.5, C.muted)
  derecha(p, money(li.monto), LETTER.W - M - 8, y, f.regular, 9)
  return y - 13
}

function total(p: PDFPage, f: BrandFonts, label: string, monto: number, y: number, fuerte = false): number {
  regla(p, y + 8, fuerte ? C.navySoft : C.lineSoft)
  texto(p, label, M + 8, y, fuerte ? f.bold : f.semibold, fuerte ? 9.5 : 9, fuerte ? C.navy : C.ink)
  derecha(p, money(monto), LETTER.W - M - 8, y, fuerte ? f.bold : f.semibold, fuerte ? 10 : 9, fuerte ? C.navy : C.ink)
  return y - 18
}
