/**
 * Impresión de etiquetas desde la app. Solo cliente: usa `document` y `fetch`.
 *
 * Se imprime HTML, no PDF: mandar un PDF obliga al navegador a abrirlo en su
 * visor, y en un equipo con «descargar los PDF en vez de abrirlos» el clic no
 * imprime nada, deja un archivo para guardar. Un HTML en un iframe oculto se
 * imprime derecho, y su `@page` declara el tamaño de papel exacto.
 *
 * Con `--kiosk-printing` (ver [docs/impresion-etiquetas.md](docs/impresion-etiquetas.md))
 * sale solo en la impresora predeterminada; si no, aparece el diálogo del
 * navegador. Que ese diálogo aparezca no se puede evitar desde una web.
 */

/**
 * Ayudante local ([scripts/ayudante-impresion.ps1](scripts/ayudante-impresion.ps1)):
 * escucha en la propia máquina y deja la impresora en el tamaño que le pidan.
 * Existe porque el navegador no puede tocar el driver, y si el papel quedó en
 * otro tamaño la etiqueta sale girada o achicada — el caso feo es olvidarse de
 * volver a 80 × 50 después de imprimir fichas y arruinar todas las de despacho.
 */
const AYUDANTE = 'http://127.0.0.1:47811'

export type ResultadoPapel =
  | { estado: 'ok' }
  | { estado: 'sin-ayudante' }          // no está instalado/corriendo: se imprime igual
  | { estado: 'error'; mensaje: string } // está, pero no pudo dejar ese tamaño

export type EstadoPapel = {
  impresora: string
  papel: string
  ancho: number
  alto: number
}

/** Qué papel tiene puesto la impresora ahora. `null` = no hay ayudante corriendo. */
export async function estadoPapel(): Promise<EstadoPapel | null> {
  try {
    const r = await fetch(`${AYUDANTE}/estado`, { signal: AbortSignal.timeout(2500) })
    const d = await r.json()
    return d?.ok ? { impresora: d.impresora, papel: d.papel, ancho: d.ancho, alto: d.alto } : null
  } catch {
    return null
  }
}

/** Deja la impresora en el tamaño de esta etiqueta, si el ayudante está corriendo. */
export async function ajustarPapel(ancho: number, alto: number): Promise<ResultadoPapel> {
  try {
    const r = await fetch(`${AYUDANTE}/papel?ancho=${ancho}&alto=${alto}`, {
      // Si no está instalado no hay que hacer esperar a nadie: se corta rápido.
      signal: AbortSignal.timeout(3000),
    })
    const d = await r.json().catch(() => null)
    if (r.ok && d?.ok) return { estado: 'ok' }
    return { estado: 'error', mensaje: d?.error || `No se pudo dejar el papel en ${ancho} × ${alto} mm` }
  } catch {
    return { estado: 'sin-ayudante' }
  }
}

/**
 * Manda el HTML a la impresora. Si se le pasan las medidas, primero le pide al
 * ayudante que deje el papel de ese tamaño; si no hay ayudante, imprime igual
 * (nunca bloquea la impresión por esto).
 */
export async function imprimirHtml(
  html: string,
  opts?: { ancho?: number; alto?: number },
): Promise<ResultadoPapel> {
  const { ancho = 80, alto = 50 } = opts ?? {}
  const papel = await ajustarPapel(ancho, alto)

  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  // Fuera de pantalla pero con el tamaño real de la etiqueta: así cualquier
  // ajuste que mida el contenido (ver etiqueta-html) trabaja sobre la caja de
  // verdad y no sobre un iframe de 1 px.
  iframe.style.cssText = `position:fixed;left:-9999px;top:0;width:${ancho}mm;height:${alto}mm;border:0`
  iframe.onload = () => {
    iframe.contentWindow?.focus()
    iframe.contentWindow?.print()
    // El diálogo es modal y bloquea; con impresión directa vuelve al toque. En
    // los dos casos hay que esperar antes de soltar el iframe.
    setTimeout(() => iframe.remove(), 120000)
  }
  iframe.srcdoc = html
  document.body.appendChild(iframe)
  return papel
}
