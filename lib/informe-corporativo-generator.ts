import { PDFDocument, PDFFont, PDFImage, PDFPage, RGB, rgb } from 'pdf-lib'
import { getSheetData } from './datastore'
import { LOGO_URL, SELLO_URL } from './email-layout'
import { fmtPrecio } from './format'
import { LETTER, C, embedBrandFonts, wrapText, type BrandFonts } from './pdf-brand'

// Texto claro sobre el navy de la portada.
const LIGHT = rgb(0xcf / 255, 0xdb / 255, 0xe8 / 255)
const COVER_MUTED = rgb(0x8f / 255, 0xa6 / 255, 0xc2 / 255)

/**
 * Dossier corporativo de Crematorio Alma Animal en PDF (formato CARTA, imprimible),
 * branded y detallado, para presentar a licitaciones públicas. Voz institucional.
 * Tipografía Inter (marca). Se arma SIEMPRE con los datos vigentes.
 */

const { W: PAGE_W, H: PAGE_H } = LETTER
const MARGIN = 58
const CONTENT_W = PAGE_W - MARGIN * 2

interface Ctx {
  doc: PDFDocument
  page: PDFPage
  y: number
  f: BrandFonts
  sello: PDFImage | null
  pageNo: number
}

async function cargarPng(doc: PDFDocument, url: string): Promise<PDFImage | null> {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    return await doc.embedPng(Uint8Array.from(Buffer.from(await r.arrayBuffer())))
  } catch { return null }
}

export async function generarInformeCorporativoPdf(): Promise<Buffer> {
  const [precios, productos, empRows] = await Promise.all([
    getSheetData('precios_generales').catch(() => []),
    getSheetData('productos').catch(() => []),
    getSheetData('empresa_config').catch(() => []),
  ])
  const emp = (empRows.find(r => String(r.id) === '1') || empRows[0] || {}) as Record<string, string>
  const E = {
    nombre: emp.nombre || 'Crematorio Alma Animal',
    rut: emp.rut || '—',
    giro: emp.giro || '—',
    direccion: emp.direccion || '—',
    telefono: emp.telefono || '+56 9 6312 6603',
    correo: emp.correo || 'contacto@crematorioalmaanimal.cl',
    web: emp.web || 'https://www.crematorioalmaanimal.cl/',
    instagram: emp.instagram || '',
  }
  const tramos = [...precios].sort((a, b) => (parseFloat(a.peso_min) || 0) - (parseFloat(b.peso_min) || 0))
  const premium = (productos as Record<string, string>[]).filter(p => /premium/i.test(p.categoria || '') && (parseInt(p.precio, 10) || 0) > 0)
  const precioPremium = premium.length ? Math.min(...premium.map(p => parseInt(p.precio, 10) || 0)) : 25000
  const relicario = (productos as Record<string, string>[]).find(p => /relicario/i.test(p.categoria || '') || /relicario/i.test(p.nombre || ''))
  const fechaCL = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date())

  const doc = await PDFDocument.create()
  const f = await embedBrandFonts(doc)
  const logo = await cargarPng(doc, LOGO_URL)
  const sello = await cargarPng(doc, SELLO_URL)
  const ctx: Ctx = { doc, page: null as unknown as PDFPage, y: 0, f, sello, pageNo: 0 }

  const text = (page: PDFPage, s: string, x: number, y: number, size: number, font: PDFFont, color: RGB) =>
    page.drawText(s, { x, y, size, font, color })
  const centerOn = (page: PDFPage, s: string, y: number, size: number, font: PDFFont, color: RGB) =>
    page.drawText(s, { x: (PAGE_W - font.widthOfTextAtSize(s, size)) / 2, y, size, font, color })

  // ───────────── Portada (navy) ─────────────
  const cover = doc.addPage([PAGE_W, PAGE_H])
  cover.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: C.navy })
  cover.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: 150, color: C.navyDeep })
  // marco dorado fino
  cover.drawRectangle({ x: 30, y: 30, width: PAGE_W - 60, height: PAGE_H - 60, borderColor: C.gold, borderWidth: 0.8, opacity: 0, borderOpacity: 0.7 })
  if (logo) {
    const lw = 138, lh = (logo.height / logo.width) * lw
    cover.drawImage(logo, { x: (PAGE_W - lw) / 2, y: PAGE_H - 210, width: lw, height: lh })
  }
  centerOn(cover, 'C R E M A T O R I O   A L M A   A N I M A L', PAGE_H - 250, 11, f.semibold, C.gold)
  // título
  centerOn(cover, 'Presentación de Servicios', PAGE_H - 348, 31, f.bold, C.white)
  cover.drawRectangle({ x: (PAGE_W - 70) / 2, y: PAGE_H - 372, width: 70, height: 2.5, color: C.gold })
  centerOn(cover, 'Dossier corporativo para licitaciones públicas', PAGE_H - 400, 12.5, f.regular, LIGHT)
  centerOn(cover, '“Huellas que no se borran”', PAGE_H - 432, 13, f.semibold, C.gold)

  // panel de identificación
  const boxX = MARGIN, boxW = CONTENT_W, boxY = 150, boxH = 132
  cover.drawRectangle({ x: boxX, y: boxY, width: boxW, height: boxH, color: C.navyDeep, borderColor: C.gold, borderWidth: 0.6, borderOpacity: 0.55 })
  cover.drawRectangle({ x: boxX, y: boxY + boxH - 30, width: boxW, height: 0, borderColor: C.gold, borderWidth: 0 })
  text(cover, 'IDENTIFICACIÓN DE LA EMPRESA', boxX + 22, boxY + boxH - 26, 9.5, f.semibold, C.gold)
  const idRows: [string, string][] = [
    ['Razón social', E.nombre],
    ['RUT', E.rut],
    ['Giro', E.giro],
    ['Domicilio', E.direccion],
  ]
  let iy = boxY + boxH - 52
  for (const [k, v] of idRows) {
    text(cover, k, boxX + 22, iy, 10, f.semibold, LIGHT)
    text(cover, v, boxX + 140, iy, 10, f.regular, C.white)
    iy -= 20
  }
  centerOn(cover, fechaCL, 56, 10, f.regular, COVER_MUTED)

  // ───────────── Helpers de contenido (páginas blancas) ─────────────
  function nuevaPagina() {
    ctx.page = doc.addPage([PAGE_W, PAGE_H])
    ctx.pageNo += 1
    ctx.page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: C.white })
    // encabezado fino
    text(ctx.page, 'CREMATORIO ALMA ANIMAL', MARGIN, PAGE_H - 40, 7.5, ctx.f.semibold, C.navySoft)
    ctx.page.drawRectangle({ x: MARGIN, y: PAGE_H - 48, width: CONTENT_W, height: 0.7, color: C.lineSoft })
    // pie
    ctx.page.drawRectangle({ x: MARGIN, y: 44, width: CONTENT_W, height: 0.7, color: C.lineSoft })
    text(ctx.page, 'Crematorio Alma Animal · Huellas que no se borran', MARGIN, 32, 8, ctx.f.regular, C.muted)
    const pn = String(ctx.pageNo)
    text(ctx.page, pn, PAGE_W - MARGIN - ctx.f.regular.widthOfTextAtSize(pn, 8), 32, 8, ctx.f.regular, C.muted)
    ctx.y = PAGE_H - 72
  }
  function need(h: number) { if (ctx.y - h < 62) nuevaPagina() }
  function gap(h: number) { ctx.y -= h }

  let secN = 0
  function h1(txt: string) {
    secN += 1
    need(54)
    gap(10)
    // chip de número navy
    ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 4, width: 22, height: 22, color: C.navy })
    const ns = String(secN)
    text(ctx.page, ns, MARGIN + 11 - ctx.f.bold.widthOfTextAtSize(ns, 11) / 2, ctx.y + 2, 11, ctx.f.bold, C.white)
    text(ctx.page, txt, MARGIN + 32, ctx.y + 1, 16, ctx.f.bold, C.navy)
    gap(20)
    ctx.page.drawRectangle({ x: MARGIN, y: ctx.y, width: 34, height: 2.5, color: C.gold })
    ctx.page.drawRectangle({ x: MARGIN + 38, y: ctx.y + 1, width: CONTENT_W - 38, height: 0.7, color: C.line })
    gap(18)
  }
  function h2(txt: string) {
    need(26)
    gap(8)
    text(ctx.page, txt, MARGIN, ctx.y, 11.5, ctx.f.semibold, C.navySoft)
    gap(15)
  }
  function p(txt: string, opts: { size?: number; color?: RGB; gapAfter?: number; lead?: number } = {}) {
    const size = opts.size ?? 10.5
    const lead = opts.lead ?? size + 4.5
    const color = opts.color ?? C.ink
    for (const ln of wrapText(txt, ctx.f.regular, size, CONTENT_W)) {
      need(lead)
      text(ctx.page, ln, MARGIN, ctx.y, size, ctx.f.regular, color)
      gap(lead)
    }
    gap(opts.gapAfter ?? 7)
  }
  function bullets(items: string[]) {
    for (const it of items) {
      const lines = wrapText(it, ctx.f.regular, 10.5, CONTENT_W - 18)
      need(lines.length * 15)
      ctx.page.drawCircle({ x: MARGIN + 3.5, y: ctx.y + 3.5, size: 2, color: C.gold })
      lines.forEach((ln, i) => {
        text(ctx.page, ln, MARGIN + 16, ctx.y, 10.5, ctx.f.regular, C.ink)
        if (i < lines.length - 1) gap(15)
      })
      gap(16)
    }
    gap(4)
  }
  /** Ítem de definición: título en negrita en una línea, descripción debajo, indentada. */
  function defItem(titulo: string, desc: string) {
    need(30)
    ctx.page.drawCircle({ x: MARGIN + 3.5, y: ctx.y + 3.5, size: 2, color: C.gold })
    text(ctx.page, titulo, MARGIN + 16, ctx.y, 10.5, ctx.f.bold, C.navy)
    gap(15)
    for (const ln of wrapText(desc, ctx.f.regular, 10.5, CONTENT_W - 16)) {
      need(15)
      text(ctx.page, ln, MARGIN + 16, ctx.y, 10.5, ctx.f.regular, C.ink)
      gap(15)
    }
    gap(7)
  }
  function tablaPrecios(rows: Record<string, string>[]) {
    const c0 = 168
    const cw = (CONTENT_W - c0) / 3
    const cols = [
      { t: 'Peso de la mascota', x: MARGIN, w: c0, align: 'l' as const },
      { t: 'Individual', x: MARGIN + c0, w: cw, align: 'r' as const },
      { t: 'Premium', x: MARGIN + c0 + cw, w: cw, align: 'r' as const },
      { t: 'Sin Devolución', x: MARGIN + c0 + cw * 2, w: cw, align: 'r' as const },
    ]
    const rowH = 22
    const put = (s: string, col: typeof cols[number], yy: number, font: PDFFont, color: RGB, size = 9.5) => {
      const w = font.widthOfTextAtSize(s, size)
      const x = col.align === 'r' ? col.x + col.w - 12 - w : col.x + 12
      text(ctx.page, s, x, yy, size, font, color)
    }
    const headerRow = () => {
      need(rowH * 2)
      ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - rowH + 5, width: CONTENT_W, height: rowH, color: C.navy })
      for (const c of cols) put(c.t, c, ctx.y - rowH + 11, ctx.f.semibold, C.white, 9)
      gap(rowH)
    }
    headerRow()
    rows.forEach((r, i) => {
      if (ctx.y - rowH < 62) { nuevaPagina(); headerRow() }
      if (i % 2 === 1) ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - rowH + 5, width: CONTENT_W, height: rowH, color: C.zebra })
      const max = r.peso_max && String(r.peso_max).trim()
      const label = max ? `${r.peso_min} – ${r.peso_max} kg` : `${r.peso_min}+ kg`
      put(label, cols[0], ctx.y - rowH + 11, ctx.f.semibold, C.navy)
      put(fmtPrecio(parseInt(r.precio_ci, 10) || 0), cols[1], ctx.y - rowH + 11, ctx.f.regular, C.ink)
      put(fmtPrecio(parseInt(r.precio_cp, 10) || 0), cols[2], ctx.y - rowH + 11, ctx.f.regular, C.ink)
      put(fmtPrecio(parseInt(r.precio_sd, 10) || 0), cols[3], ctx.y - rowH + 11, ctx.f.regular, C.ink)
      ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - rowH + 5, width: CONTENT_W, height: 0.5, color: C.lineSoft })
      gap(rowH)
    })
    ctx.page.drawRectangle({ x: MARGIN, y: ctx.y + 5, width: CONTENT_W, height: 0.8, color: C.line })
    gap(12)
  }

  // ════════════════════ CONTENIDO ════════════════════
  nuevaPagina()

  h1('Presentación de la empresa')
  p('Crematorio Alma Animal es una empresa chilena dedicada a la cremación digna y responsable de mascotas, con instalaciones propias ubicadas en la comuna de Recoleta, Región Metropolitana. Brindamos un servicio cercano, rápido y trazable a las familias que atraviesan la despedida de su mascota, así como a clínicas y hospitales veterinarios que requieren un partner confiable para la disposición final.')
  p('Operamos todos los días del año, en horario extendido de 09:00 a 22:00 horas, con cobertura en toda la Región Metropolitana. Nuestra propuesta combina un trato humano y respetuoso con un alto estándar técnico y tecnológico: control directo de todo el proceso, trazabilidad documentada y comunicación permanente con el cliente.')
  h2('Datos de identificación')
  bullets([
    `Razón social: ${E.nombre}`,
    `RUT: ${E.rut}`,
    `Giro: ${E.giro}`,
    `Domicilio: ${E.direccion}`,
    'Cobertura: Región Metropolitana · Atención todos los días de 09:00 a 22:00 h',
  ])

  h1('Propósito e identidad de marca')
  p('Nuestro propósito es acompañar a las familias en la despedida de su mascota con cercanía, transparencia y respeto absoluto, entregando certeza en un momento sensible. Lo resume nuestro lema: “Huellas que no se borran”.')
  h2('Promesa de servicio')
  p('Un servicio cercano, rápido y responsable, con todo el proceso bajo control directo y respeto absoluto por la mascota y su familia.')
  h2('Valores')
  bullets([
    'Respeto y dignidad en cada etapa del proceso.',
    'Transparencia y trazabilidad total, verificable por el cliente.',
    'Cercanía y acompañamiento humano, sin perder profesionalismo.',
    'Responsabilidad ambiental y sanitaria en la disposición final.',
  ])

  h1('Servicios de cremación')
  p('Ofrecemos cremación trazable en tres modalidades, para adaptarnos a las necesidades y posibilidades de cada familia. En todos los casos el proceso es trazable y con seguimiento documentado.')
  // Mantener alineado con MODALIDADES_SERVICIOS (lib/diferenciadores.ts), la
  // fuente única de qué incluye cada servicio.
  defItem('Cremación Individual', 'Certificado de cremación digital, ánfora de greda marmoleada, botellita con mechón de pelo, etiqueta de madera con el nombre, retiro en domicilio o clínica y entrega en 4 días hábiles.')
  defItem('Cremación Premium', 'Incluye todo lo de la modalidad Individual y, además, un cuadro en acuarela conmemorativo y ánfora premium a elección de nuestra selección.')
  defItem('Cremación Sin Devolución', 'Certificado de cremación y retiro en domicilio o clínica, sin devolución de cenizas. Es la alternativa más económica, manteniendo el mismo estándar de proceso y respeto.')
  p('Servicio complementario: coordinamos eutanasia a domicilio a través de una red de médicos veterinarios en convenio, que acuden al domicilio de la familia y permiten gestionar en un mismo proceso la eutanasia y la posterior cremación. Se cotiza por caso según las características del servicio.', { color: C.muted, size: 10 })

  h1('Tarifas vigentes')
  p('Valores en pesos chilenos (CLP), por tramo de peso de la mascota y modalidad de servicio. Las tarifas se administran en nuestro sistema y se mantienen siempre actualizadas; este documento refleja los valores vigentes a la fecha de emisión.')
  if (tramos.length) tablaPrecios(tramos)
  bullets([
    'La entrega de cenizas y certificado se realiza en un máximo de 4 días hábiles.',
    'Recargo de $20.000 por retiro en comunas fuera de la zona habitual (Lampa, Buin, Colina, Calera de Tango y Paine).',
    'Para mascotas de peso superior al último tramo, el valor se cotiza de forma individual.',
  ])

  h1('Proceso operativo')
  p('Controlamos directamente cada etapa, sin externalizar ninguna parte del proceso. Esto nos permite garantizar plazos, trazabilidad y respeto en todo momento.')
  defItem('1. Contacto y coordinación', 'Recibimos la solicitud (familia o clínica), registramos los datos de la mascota y coordinamos el retiro.')
  defItem('2. Retiro', 'Retiramos a la mascota a domicilio o desde la clínica veterinaria en un vehículo habilitado, habitualmente en menos de 3 horas.')
  defItem('3. Refrigeración', 'La mascota ingresa a nuestra cámara de refrigeración hasta el momento de la cremación, preservando las condiciones sanitarias.')
  defItem('4. Cremación trazable', 'Se realiza en horno certificado, con un código de seguimiento único asignado a cada caso.')
  defItem('5. Entrega', 'Entregamos las cenizas junto al certificado digital de cremación en un máximo de 4 días hábiles. Disponemos de video del proceso para quien lo solicite.')

  h1('Trazabilidad, certificación y control')
  p('La trazabilidad es uno de los pilares de nuestro servicio y un diferenciador clave frente a alternativas que externalizan la operación.')
  bullets([
    'Código de seguimiento asignado a cada mascota, que acompaña todo el proceso.',
    'Certificado digital de cremación con firma electrónica (estándar PAdES / PKCS#7), verificable y con sello formal de la empresa.',
    'Proceso 100% propio y no externalizado: control directo de retiro, refrigeración, cremación y entrega.',
    'Registro documentado de cada etapa en nuestro sistema de gestión interno.',
    'Cumplimiento sanitario y ambiental en la disposición final de residuos no peligrosos (giro de la empresa).',
  ])

  h1('Instalaciones propias y certificadas')
  p('Contamos con instalaciones e infraestructura propias y certificadas en Recoleta, lo que nos permite operar con autonomía y un alto estándar técnico:')
  bullets([
    'Horno crematorio certificado.',
    'Cámara de refrigeración para mantener a la mascota en condiciones sanitarias hasta la cremación.',
    'Vehículo habilitado para el retiro a domicilio y desde clínicas.',
    'Sistema de gestión propio que administra fichas, trazabilidad, certificados, despachos y comunicación con el cliente.',
  ])

  h1('Productos: ánforas y recordatorios')
  p('La cremación Individual y Premium incluyen, sin costo adicional, un ánfora de greda entregada según el tamaño de la mascota. Adicionalmente ofrecemos una selección de ánforas premium y recordatorios.')
  bullets([
    'Ánfora de greda: incluida por defecto en el servicio, sin costo.',
    `Ánforas premium (a elección): ${fmtPrecio(precioPremium)} por unidad; incluidas al elegir la modalidad Premium.`,
    `Relicario / recordatorio: ${relicario ? fmtPrecio(parseInt(relicario.precio, 10) || 0) : 'consultar'}.`,
  ])
  p('Disponemos de un catálogo de productos actualizado con fotografías y valores, disponible para su descarga y envío.', { color: C.muted, size: 10 })

  h1('Comunicación y contacto permanente')
  p('El acompañamiento y la información son parte central de nuestro servicio. Mantenemos contacto permanente con el cliente durante todo el proceso:')
  bullets([
    'Atención todos los días de 09:00 a 22:00 horas, por teléfono y WhatsApp.',
    'Asistente de atención por WhatsApp para coordinar retiros, resolver consultas y entregar información en tiempo real.',
    'Notificaciones automáticas por correo en cada hito: registro, inicio de la cremación, salida a ruta de entrega, entrega realizada y emisión del certificado.',
    'Posibilidad de seguimiento del estado de cada caso y entrega del certificado digital.',
  ])

  h1('Convenios con clínicas y hospitales veterinarios')
  p('Trabajamos como partner de clínicas y hospitales veterinarios, con un modelo B2B orientado a la confianza y la eficiencia:')
  bullets([
    'Retiro coordinado directamente desde la clínica, en vehículo habilitado.',
    'Tarifas preferentes para establecimientos en convenio.',
    'Trazabilidad documentada y certificado para respaldo del establecimiento y de la familia.',
    'Informes y estados de cuenta para la gestión administrativa del convenio.',
    'Red de eutanasia a domicilio para derivar y coordinar casos en la zona de cada clínica.',
  ])

  h1('Valor agregado y diferenciadores')
  bullets([
    'Instalaciones propias en Recoleta: no externalizamos ninguna etapa del proceso.',
    'Trazabilidad total con código de seguimiento y certificado digital firmado.',
    'Entrega garantizada en un máximo de 4 días hábiles.',
    'Retiro a domicilio y desde clínicas, habitualmente en menos de 3 horas.',
    'Atención todos los días, 09:00 a 22:00 h, con contacto permanente por WhatsApp y correo.',
    'Tecnología propia de gestión, trazabilidad y comunicación.',
    'Red de eutanasia a domicilio como servicio complementario.',
    'Trato humano, cercano y respetuoso, con foco en la dignidad de la mascota y su familia.',
  ])

  h1('Datos de la empresa y contacto')
  bullets([
    `Razón social: ${E.nombre}`,
    `RUT: ${E.rut}`,
    `Giro: ${E.giro}`,
    `Domicilio: ${E.direccion}`,
    `Teléfono / WhatsApp: ${E.telefono}`,
    `Correo: ${E.correo}`,
    `Sitio web: ${E.web}`,
    ...(E.instagram ? [`Instagram: ${E.instagram}`] : []),
  ])
  if (ctx.sello) {
    const sw = 74, sh = (ctx.sello.height / ctx.sello.width) * sw
    need(sh + 10)
    ctx.page.drawImage(ctx.sello, { x: PAGE_W - MARGIN - sw, y: ctx.y - sh, width: sw, height: sh })
  }

  return Buffer.from(await doc.save())
}
