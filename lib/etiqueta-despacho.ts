import { PDFDocument, degrees, rgb } from 'pdf-lib'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { embedBrandFonts, fitText, wrapText } from './pdf-brand'
import { ETIQUETA_PT, L, formatearTelefono, type EtiquetaDespachoData } from './etiqueta-datos'

export { datosEtiqueta, ETIQUETA_MM, ETIQUETA_PT, L, formatearTelefono } from './etiqueta-datos'
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

const W = ETIQUETA_PT.ancho   // 226.77 pt
const H = ETIQUETA_PT.alto   // 141.73 pt

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

  const M = L.margen
  const maxW = W - M * 2
  const topY = H - M

  // ── Cabecera: logo monocromo + código de servicio ──────────────────────────
  // Es la versión de un solo color del logo (la misma del certificado): sale
  // limpia en una impresora térmica en blanco y negro.
  const codigo = (data.codigo || '—').toUpperCase()
  let codSize = codigo.length > 9 ? L.codigoLargo : L.codigo
  const logoPath = join(process.cwd(), 'public', 'certificates', 'logo_alma_animal.png')
  const logo = existsSync(logoPath) ? await doc.embedPng(readFileSync(logoPath)) : null
  const logoH = logo ? Math.min(L.logoAlto, (L.logoAnchoMax / logo.width) * logo.height) : 0
  const logoW = logo ? (logo.width / logo.height) * logoH : 0

  // El código nunca se come al logo: si no cabe al lado, se achica.
  const anchoCodigo = W - M * 2 - logoW - 8
  while (codSize > 10 && f.bold.widthOfTextAtSize(codigo, codSize) > anchoCodigo) codSize -= 0.5

  const cabeceraH = Math.max(logoH, codSize + L.codigoRotulo + 1)
  const cabeceraBase = topY - cabeceraH
  if (logo) {
    page.drawImage(logo, { x: M, y: cabeceraBase + (cabeceraH - logoH) / 2, width: logoW, height: logoH })
  }
  const codW = f.bold.widthOfTextAtSize(codigo, codSize)
  page.drawText(codigo, { x: W - M - codW, y: cabeceraBase + L.codigoRotulo + 1, size: codSize, font: f.bold, color: NEGRO })
  page.drawText('CÓDIGO', {
    x: W - M - f.regular.widthOfTextAtSize('CÓDIGO', L.codigoRotulo),
    y: cabeceraBase, size: L.codigoRotulo, font: f.regular, color: GRIS,
  })

  const reglaY = cabeceraBase - L.reglaGap
  page.drawLine({ start: { x: M, y: reglaY }, end: { x: W - M, y: reglaY }, thickness: 1, color: NEGRO })

  // ── Datos: ocupan TODO lo que queda ────────────────────────────────────────
  // Se mide cuánto pesa cada campo (con sus líneas reales) y el espacio sobrante
  // se reparte entre ellos, así la etiqueta nunca queda con un hueco abajo.
  const base = [
    { rotulo: 'MASCOTA', valor: data.nombre_mascota, size: L.mascota, font: f.bold, maxLineas: 1 },
    { rotulo: 'TUTOR', valor: data.nombre_tutor, size: L.tutor, font: f.semibold, maxLineas: 1 },
    { rotulo: 'DIRECCIÓN', valor: data.direccion, size: L.direccion, font: f.semibold, maxLineas: 2 },
    { rotulo: 'TELÉFONO', valor: formatearTelefono(data.telefono), size: L.telefono, font: f.semibold, maxLineas: 1 },
  ]
  const medir = (escala: number, topeLineas = 9) => base.map(c => {
    const size = c.size * escala
    const texto = c.valor || '—'
    const max = Math.min(c.maxLineas, topeLineas)
    const lineas = (max > 1 ? wrapText(texto, c.font, size, maxW) : [texto]).slice(0, max)
    lineas[lineas.length - 1] = fitText(lineas[lineas.length - 1], c.font, size, maxW)
    const alto = L.rotulo + L.rotuloGap + lineas.length * size + (lineas.length - 1) * L.interlineado
    return { ...c, size, lineas, alto }
  })

  const disponible = reglaY - L.trasRegla - M
  const minimo = L.huecoMin * (base.length - 1)
  const cabe = (cs: Array<{ alto: number }>) => cs.reduce((s, c) => s + c.alto, 0) + minimo <= disponible

  // Una dirección larga ocupa dos líneas y ya no entra a tamaño nominal. En vez de
  // salirse de la etiqueta, se achican los valores de a poco (los rótulos no
  // escalan, así que no sirve una regla de tres: hay que probar). Si ni al 72 %
  // entra, la dirección se recorta a una línea, que siempre cabe.
  let escala = 1
  let campos = medir(escala)
  while (!cabe(campos) && escala > 0.72) {
    escala = Math.max(0.72, escala - 0.04)
    campos = medir(escala)
  }
  if (!cabe(campos)) campos = medir(escala, 1)

  const usado = campos.reduce((s, c) => s + c.alto, 0)
  const hueco = Math.max(L.huecoMin, (disponible - usado) / (base.length - 1))

  let y = reglaY - L.trasRegla
  for (const c of campos) {
    page.drawText(c.rotulo, { x: M, y: y - L.rotulo, size: L.rotulo, font: f.regular, color: GRIS })
    let ly = y - L.rotulo - L.rotuloGap - c.size
    for (const linea of c.lineas) {
      page.drawText(linea, { x: M, y: ly, size: c.size, font: c.font, color: NEGRO })
      ly -= c.size + L.interlineado
    }
    y -= c.alto + hueco
  }

  return Buffer.from(await doc.save())
}
