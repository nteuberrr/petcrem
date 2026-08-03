import { PDFDocument, degrees, rgb } from 'pdf-lib'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { embedBrandFonts, fitText, wrapText } from './pdf-brand'
import { ETIQUETA_MM, formatearTelefono, type EtiquetaDespachoData } from './etiqueta-datos'

export { datosEtiqueta, ETIQUETA_MM, formatearTelefono } from './etiqueta-datos'
export type { EtiquetaDespachoData } from './etiqueta-datos'

/**
 * Etiqueta de despacho para impresora térmica de etiquetas.
 *
 * El rollo es de 80 × 50 mm con el lado de 80 mm en el sentido del avance del
 * papel, así que la etiqueta se IMPRIME VERTICAL (50 de ancho × 80 de alto) pero
 * el contenido se lee A LO ANCHO. Por eso el contenido se dibuja en una página
 * apaisada de 80 × 50 mm y se marca con /Rotate 90: el visor y la impresora la
 * sacan vertical con el texto girado, sin que haya que calcular coordenadas
 * rotadas a mano. En la app la vista previa es HTML y va horizontal (se lee mejor).
 */

const MM = 72 / 25.4          // 1 mm en puntos PDF
const W = ETIQUETA_MM.ancho * MM   // 226.77 pt
const H = ETIQUETA_MM.alto * MM    // 141.73 pt

// Impresión térmica: todo en negro puro. Un gris claro se dithera y se ve sucio.
const NEGRO = rgb(0, 0, 0)
const GRIS = rgb(0.35, 0.35, 0.35)

export async function generarEtiquetaDespacho(data: EtiquetaDespachoData): Promise<Buffer> {
  const doc = await PDFDocument.create()
  doc.setTitle(`Etiqueta de despacho — ${data.codigo || data.nombre_mascota}`)
  doc.setAuthor('Alma Animal')

  const f = await embedBrandFonts(doc)
  const page = doc.addPage([W, H])
  // El contenido va apaisado, el papel sale vertical.
  page.setRotation(degrees(90))

  const M = 6           // margen
  const maxW = W - M * 2

  // ── Cabecera: logo monocromo + código de servicio ──────────────────────────
  // Es la versión de un solo color del logo (la misma del certificado): sale
  // limpia en una impresora térmica en blanco y negro.
  const logoPath = join(process.cwd(), 'public', 'certificates', 'logo_alma_animal.png')
  const topY = H - M
  if (existsSync(logoPath)) {
    const logo = await doc.embedPng(readFileSync(logoPath))
    const h = Math.min(22, (90 / logo.width) * logo.height)
    const w = (logo.width / logo.height) * h
    page.drawImage(logo, { x: M, y: topY - h, width: w, height: h })
  }

  const codigo = (data.codigo || '—').toUpperCase()
  const codSize = codigo.length > 9 ? 14 : 17
  const codW = f.bold.widthOfTextAtSize(codigo, codSize)
  page.drawText(codigo, { x: W - M - codW, y: topY - 16, size: codSize, font: f.bold, color: NEGRO })
  page.drawText('CÓDIGO', {
    x: W - M - f.regular.widthOfTextAtSize('CÓDIGO', 5.5),
    y: topY - 22.5, size: 5.5, font: f.regular, color: GRIS,
  })
  let y = topY - 28
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: NEGRO })
  y -= 11

  /** Etiqueta chica arriba + valor abajo. Devuelve la nueva Y. */
  const campo = (rotulo: string, valor: string, size: number, negrita = false, maxLineas = 1): number => {
    page.drawText(rotulo, { x: M, y, size: 5.5, font: f.regular, color: GRIS })
    y -= size + 1.5
    const font = negrita ? f.bold : f.semibold
    const texto = valor || '—'
    if (maxLineas > 1) {
      const lineas = wrapText(texto, font, size, maxW).slice(0, maxLineas)
      for (let i = 0; i < lineas.length; i++) {
        const linea = i === maxLineas - 1 ? fitText(lineas[i], font, size, maxW) : lineas[i]
        page.drawText(linea, { x: M, y, size, font, color: NEGRO })
        if (i < lineas.length - 1) y -= size + 1
      }
    } else {
      page.drawText(fitText(texto, font, size, maxW), { x: M, y, size, font, color: NEGRO })
    }
    y -= 8
    return y
  }

  campo('MASCOTA', data.nombre_mascota, 12, true)
  campo('TUTOR', data.nombre_tutor, 10)
  campo('DIRECCIÓN', data.direccion, 8, false, 2)
  campo('TELÉFONO', formatearTelefono(data.telefono), 10)

  return Buffer.from(await doc.save())
}
