import { L, MM, formatearTelefono, type EtiquetaDespachoData } from './etiqueta-datos'

/**
 * Etiqueta de despacho como documento HTML de 80 × 50 mm, listo para imprimir.
 *
 * Por qué HTML y no el PDF: mandar el PDF a imprimir obliga al navegador a
 * abrirlo en su visor, y si el equipo tiene «descargar los PDF en vez de
 * abrirlos» (o el visor no engancha), en vez de imprimir queda un archivo para
 * guardar. Con un HTML no hay visor de por medio: `print()` va derecho al
 * diálogo de la impresora — o directo al papel con `--kiosk-printing`.
 *
 * Es la MISMA pieza que muestra la vista previa de la ficha, así que lo que se
 * ve es lo que sale impreso. El PDF de `/api/clientes/[id]/etiqueta` sigue vivo
 * como respaldo descargable.
 *
 * Las medidas salen de las constantes de [etiqueta-datos.ts](etiqueta-datos.ts)
 * (en puntos, igual que el generador de PDF) convertidas a mm, para que las tres
 * piezas no se desalineen.
 */

const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string
))

/** Puntos PDF → milímetros, con 2 decimales. */
const mm = (pt: number) => `${(pt / MM).toFixed(2)}mm`

/**
 * Base tipográfica del bloque de datos. Los valores van en `em` sobre esta base,
 * así el ajuste automático (achicar hasta que entre) solo cambia este número.
 */
const BASE_PT = 10
const em = (pt: number) => `${(pt / BASE_PT).toFixed(3)}em`

export function etiquetaHtml(d: EtiquetaDespachoData, opts?: { logoUrl?: string }): string {
  const logo = opts?.logoUrl || '/certificates/logo_alma_animal.png'
  const codigo = (d.codigo || '—').toUpperCase()
  // El código es lo que se lee de lejos; si es largo no debe comerse al logo.
  const codigoPt = codigo.length > 9 ? L.codigoLargo : L.codigo

  const campos = [
    { rotulo: 'MASCOTA', valor: d.nombre_mascota, pt: L.mascota, lineas: 1 },
    { rotulo: 'TUTOR', valor: d.nombre_tutor, pt: L.tutor, lineas: 1 },
    { rotulo: 'DIRECCIÓN', valor: d.direccion, pt: L.direccion, lineas: 2 },
    { rotulo: 'TELÉFONO', valor: formatearTelefono(d.telefono), pt: L.telefono, lineas: 1 },
  ]

  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<title>Etiqueta ${esc(codigo)}</title>
<style>
  /* El tamaño de papel se declara acá: la impresora saca la etiqueta 1:1, sin
     "ajustar a la página" ni márgenes que la corran. */
  @page { size: 80mm 50mm; margin: 0 }
  * { margin: 0; padding: 0; box-sizing: border-box }
  html, body { width: 80mm; height: 50mm }
  body {
    /* Fuentes del sistema: no dependemos de descargar nada para imprimir. */
    font-family: system-ui, -apple-system, "Segoe UI", Arial, Helvetica, sans-serif;
    /* Térmica: negro puro. Un gris claro se dithera y sale sucio. */
    color: #000; background: #fff;
    padding: ${mm(L.margen)};
    display: flex; flex-direction: column; overflow: hidden;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .cab { display: flex; align-items: center; justify-content: space-between; gap: ${mm(8)} }
  .cab img { height: ${mm(L.logoAlto)}; max-width: ${mm(L.logoAnchoMax)}; width: auto }
  .cod { text-align: right; line-height: 1; min-width: 0 }
  .cod b { display: block; font-size: ${mm(codigoPt)}; font-weight: 800; letter-spacing: -.02em; white-space: nowrap }
  .cod span { font-size: ${mm(L.codigoRotulo)}; color: #595959 }
  .regla { border-top: .3mm solid #000; margin: ${mm(L.reglaGap)} 0 ${mm(L.trasRegla)} }
  .campos { flex: 1; min-height: 0; display: flex; flex-direction: column; justify-content: space-between;
            overflow: hidden; font-size: ${mm(BASE_PT)} }
  .rot { font-size: ${em(L.rotulo)}; color: #595959; line-height: 1 }
  .val { font-weight: 700; line-height: 1.06; margin-top: ${em(L.rotuloGap)}; overflow: hidden;
         overflow-wrap: anywhere }
  .una { white-space: nowrap; text-overflow: ellipsis }
  .dos { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical }
</style>
</head><body>
  <div class="cab">
    <img src="${esc(logo)}" alt="Alma Animal">
    <div class="cod"><b>${esc(codigo)}</b><span>CÓDIGO</span></div>
  </div>
  <div class="regla"></div>
  <div class="campos" id="campos">
    ${campos.map(c => `<div>
      <p class="rot">${esc(c.rotulo)}</p>
      <p class="val ${c.lineas > 1 ? 'dos' : 'una'}" style="font-size:${em(c.pt)}">${esc(c.valor || '—')}</p>
    </div>`).join('')}
  </div>
  <script>
    // Ajuste automático: una dirección larga o un nombre kilométrico no pueden
    // empujar el contenido fuera de la etiqueta. Se achica el bloque de datos
    // (todo va en em sobre su font-size) hasta que entre. Como acá SÍ se mide el
    // texto ya renderizado, es más fiel que estimar por cantidad de caracteres.
    (function () {
      var c = document.getElementById('campos')
      var pt = ${BASE_PT}
      while (c.scrollHeight > c.clientHeight && pt > 6) {
        pt -= 0.3
        c.style.fontSize = (pt / ${MM}).toFixed(3) + 'mm'
      }
    })()
  </script>
</body></html>`
}
