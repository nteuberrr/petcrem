import { AJUSTE, MM } from './etiqueta-datos'

/**
 * Etiquetas que se imprimen "en blanco" desde Configuración → Etiquetas, por
 * cantidad: no dependen de una ficha, son insumos que el equipo deja listos.
 *
 *  · Ficha de retiro (100 × 150 mm) — formulario que se llena A MANO en el
 *    momento del retiro: mascota, tutor, código y fecha. El logo va grande
 *    arriba a la izquierda y los cuatro campos abajo, con líneas altas para
 *    escribir cómodo.
 *  · Sticker del logo (60 × 60 mm) — solo el logo, para pegar en cajas/ánforas.
 *
 * Igual que la etiqueta de despacho ([etiqueta-html.ts](etiqueta-html.ts)), se
 * imprimen como HTML y no como PDF: el `@page` le declara el papel exacto a la
 * impresora y no hay visor de PDF de por medio que termine descargando un
 * archivo en vez de imprimir.
 *
 * Cada formato trae su propio `ajuste` de posición: la impresora no estampa
 * exactamente donde dice el papel, y cada rollo se carga distinto. El de 80 × 50
 * (etiqueta de despacho) usa `AJUSTE`; estos parten de ahí y se calibran solos.
 */

export type FormatoEtiqueta = 'ficha-retiro' | 'sticker-logo'

export const FORMATOS: Record<FormatoEtiqueta, {
  nombre: string
  descripcion: string
  ancho: number   // mm
  alto: number    // mm
  /**
   * Cuánto hay que correr el contenido, en mm, para que caiga bien en el papel
   * (la impresora no estampa exactamente donde dice el papel). Es TOTAL, no se
   * suma al AJUSTE base: cada rollo se carga distinto y desalinea distinto.
   * Se calibra imprimiendo una y midiendo con una regla.
   */
  ajuste: { x: number; y: number }
}> = {
  'ficha-retiro': {
    nombre: 'Ficha de retiro',
    descripcion: 'Formulario para llenar a mano: mascota, tutor, código y fecha de retiro.',
    ancho: 100,
    alto: 150,
    ajuste: { x: AJUSTE.x / MM, y: AJUSTE.y / MM },
  },
  'sticker-logo': {
    nombre: 'Sticker del logo',
    descripcion: 'Solo el logo, para pegar en cajas, ánforas o bolsas.',
    ancho: 60,
    alto: 60,
    /**
     * Vuelto a la corrección base (2026-08-03). Los valores anteriores
     * (−3,4 / +5,5) se habían calibrado imprimiendo cuando el driver NO tenía
     * el papel de 60 × 60 y el sticker salía sobre un tamaño que no era el
     * suyo: compensaban ese desajuste, no el de la impresora. Ya creado el
     * 60 × 60 real, se arranca de cero y se recalibra con una impresión.
     *
     * Negativo = izquierda / arriba. El script de abajo topa el movimiento
     * contra el borde, así que nunca corta ni achica el logo.
     */
    ajuste: { x: AJUSTE.x / MM, y: AJUSTE.y / MM },
  },
}

/** Campos que se completan a mano en la ficha de retiro. */
const CAMPOS_FICHA = ['MASCOTA', 'TUTOR', 'CÓDIGO', 'FECHA DE RETIRO']

/** Logo de línea en negro puro: es el que sale limpio en una térmica. */
export const LOGO_NEGRO = '/brand/alma-animal-negro.png'

/**
 * Corre el logo del sticker hacia abajo y a la derecha TODO lo que se pueda sin
 * achicarlo ni cortarlo: pide el ajuste del formato y se queda con lo que dé el
 * espacio libre hasta el borde del papel.
 *
 * Va como script y no como CSS porque el tope depende de cuánto mide el logo YA
 * renderizado, y eso solo se sabe en el navegador. A tamaño completo el logo casi
 * llena el papel, así que el margen real es de pocos milímetros: el arreglo de
 * fondo es calibrar la posición en la impresora, no correrlo por software.
 */
function scriptCorrerSticker(ajuste: { x: number; y: number }): string {
  return `  <script>
    (function () {
      var aire = 0.5   // mm que se dejan libres contra el borde
      var porMm = 96 / 25.4
      // Tope en los dos sentidos: hacia la derecha/abajo lo frena el borde que
      // tiene delante, hacia la izquierda/arriba el de atrás. Nunca recorta.
      function topar(pedido, libreAntes, libreDespues) {
        if (pedido >= 0) return Math.min(pedido, Math.max(0, libreDespues))
        return Math.max(pedido, -Math.max(0, libreAntes))
      }
      function correr() {
        document.querySelectorAll('.sticker img').forEach(function (img) {
          var hoja = img.closest('.hoja').getBoundingClientRect()
          var r = img.getBoundingClientRect()
          var a = aire * porMm
          var dx = topar(${ajuste.x} * porMm, r.left - hoja.left - a, hoja.right - r.right - a)
          var dy = topar(${ajuste.y} * porMm, r.top - hoja.top - a, hoja.bottom - r.bottom - a)
          img.style.transform = 'translate(' + dx + 'px,' + dy + 'px)'
        })
      }
      // Recién en 'load' el logo tiene su tamaño real; antes mide 0 y el tope
      // daría espacio de sobra (y lo correría hasta salirse del papel).
      if (document.readyState === 'complete') correr()
      else window.addEventListener('load', correr)
    })()
  </script>`
}

/**
 * Documento imprimible con `copias` páginas del formato pedido.
 *
 * `logoUrl` permite pasar una URL absoluta (el iframe de impresión hereda la
 * base del documento, pero al previsualizar fuera de la app conviene fijarla).
 *
 * `ajustar` (por defecto sí) aplica la corrección de posición de la impresora.
 * En la VISTA PREVIA va en `false`: esa corrección compensa un defecto del
 * hardware, no es parte del diseño, y en pantalla solo se ve como una etiqueta
 * descuadrada. Impreso sí va; en pantalla, no.
 */
export function etiquetasHtml(
  formato: FormatoEtiqueta,
  copias: number,
  opts?: { logoUrl?: string; ajustar?: boolean },
): string {
  const f = FORMATOS[formato]
  const n = Math.max(1, Math.min(200, Math.floor(copias) || 1))
  const logo = opts?.logoUrl || LOGO_NEGRO
  const ajustar = opts?.ajustar !== false
  const esSticker = formato === 'sticker-logo'
  const cuerpo = esSticker ? stickerLogo(logo) : fichaRetiro(logo)
  // El sticker NO desplaza la hoja por CSS: el logo ocupa casi todo el papel y
  // moverlo a ciegas lo cortaría. Lo mueve el script de abajo, con tope.
  const desplazar = esSticker || !ajustar ? { x: 0, y: 0 } : f.ajuste

  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<title>${f.nombre} — ${n} ${n === 1 ? 'etiqueta' : 'etiquetas'}</title>
<style>
  @page { size: ${f.ancho}mm ${f.alto}mm; margin: 0 }
  * { margin: 0; padding: 0; box-sizing: border-box }
  html, body { width: ${f.ancho}mm }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", Arial, Helvetica, sans-serif;
    color: #000; background: #fff;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  /* Una página por copia. */
  .hoja { width: ${f.ancho}mm; height: ${f.alto}mm; overflow: hidden }
  .hoja:not(:last-child) { break-after: page; page-break-after: always }
  /* La impresora no estampa donde dice el papel: se compensa TRASLADANDO la hoja
     entera (ver el ajuste del formato), no con padding. Con padding lo centrado
     queda a medio camino —se centraría en el ancho ya recortado— y el sticker
     no se movería lo pedido. */
  .interior {
    width: ${f.ancho}mm; height: ${f.alto}mm; display: flex; flex-direction: column;
    transform: translate(${desplazar.x}mm, ${desplazar.y}mm);
  }

  /* ── Ficha de retiro ─────────────────────────────────────────────────── */
  .ficha { padding: 7mm 7mm 6mm 6mm }
  .ficha .cab { display: flex; align-items: center; gap: 5mm }
  .ficha .cab img { width: 30mm; height: auto; flex: none }
  .ficha h1 { font-size: 7.2mm; font-weight: 800; line-height: 1.05; letter-spacing: -.02em }
  .ficha .sub { font-size: 3.1mm; color: #444; margin-top: 1.2mm; letter-spacing: .06em; text-transform: uppercase }
  .ficha .regla { border-top: .6mm solid #000; margin: 5mm 0 0 }
  .ficha .campos { flex: 1; display: flex; flex-direction: column; justify-content: space-around; padding-top: 2mm }
  .ficha .rot { font-size: 3.4mm; font-weight: 700; letter-spacing: .12em; color: #333 }
  /* La línea para escribir: alta a propósito, se llena con lápiz. */
  .ficha .linea { border-bottom: .4mm solid #000; height: 13mm }

  /* ── Sticker: solo el logo, lo más grande que entre ───────────────────── */
  .sticker { align-items: center; justify-content: center; padding: 4mm }
  .sticker img { max-width: 100%; max-height: 100%; width: auto; height: auto }
</style>
</head><body>
${Array.from({ length: n }, () => `  <div class="hoja">${cuerpo}</div>`).join('\n')}
${esSticker && ajustar ? scriptCorrerSticker(f.ajuste) : ''}
</body></html>`
}

function fichaRetiro(logo: string): string {
  return `<div class="interior ficha">
    <div class="cab">
      <img src="${logo}" alt="Alma Animal">
      <div>
        <h1>Ficha de<br>retiro</h1>
        <p class="sub">Crematorio Alma Animal</p>
      </div>
    </div>
    <div class="regla"></div>
    <div class="campos">
      ${CAMPOS_FICHA.map(c => `<div><p class="rot">${c}</p><div class="linea"></div></div>`).join('\n      ')}
    </div>
  </div>`
}

function stickerLogo(logo: string): string {
  return `<div class="interior sticker"><img src="${logo}" alt="Alma Animal"></div>`
}
