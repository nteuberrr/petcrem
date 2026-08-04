import './_env-preload'
import sharp from 'sharp'
import { join } from 'path'

/**
 * Prepara el logo que va en la etiqueta de despacho, a partir del lockup
 * horizontal de marca (pata a la izquierda + «ALMA ANIMAL» al lado).
 *
 * Correr con:  npx tsx scripts/preparar-logo-etiqueta.ts
 *
 * Tres cosas que hay que hacerle antes de mandarlo a una térmica:
 *
 *  1. RECORTAR el aire. El archivo de marca viene con muchísimo margen (y una
 *     franja vacía abajo). Sin recortar, el `height` del CSS lo toma el aire y
 *     el logo sale ridículamente chico dentro de la etiqueta.
 *  2. Pasarlo a NEGRO PURO sobre blanco. El navy (#1F3A5F) en una impresora
 *     térmica se dithera y sale gris sucio. Se estira el contraste para que la
 *     línea quede negra y el fondo blanco limpio.
 *  3. AGRANDAR el «huellas que no se borran». En el lockup original esa línea es
 *     muy chica: a los 11 mm de alto que tiene el logo en la etiqueta quedaba en
 *     0,8 mm y la térmica la escupía como una manchita gris. Se separa del resto
 *     (hay una banda en blanco entre medio) y se agranda solo ella.
 *
 * Sale en `public/brand/logo-etiqueta.png`, que usan el HTML que se imprime
 * ([lib/etiqueta-html.ts](../lib/etiqueta-html.ts)) y el PDF de respaldo
 * ([lib/etiqueta-despacho.ts](../lib/etiqueta-despacho.ts)).
 */

const ORIGEN = join(process.cwd(), 'public', 'brand', 'alma-animal-horizontal.jpg')
const DESTINO = join(process.cwd(), 'public', 'brand', 'logo-etiqueta.png')

/** Cuánto se agranda la bajada respecto del resto del logo. */
const FACTOR_BAJADA = 1.3
/** Aire entre el logo y la bajada, como fracción del alto de la bajada. */
const AIRE = 0.55

/** Filas totalmente blancas, para saber dónde separar la bajada del resto. */
async function bandasEnBlanco(buf: Buffer) {
  const { data, info } = await sharp(buf).greyscale().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h, channels: c } = info
  const bandas: { desde: number; hasta: number }[] = []
  let ini = -1
  for (let y = 0; y < h; y++) {
    let conTinta = false
    for (let x = 0; x < w; x++) { if (data[(y * w + x) * c] < 128) { conTinta = true; break } }
    if (!conTinta) { if (ini < 0) ini = y }
    else if (ini >= 0) { bandas.push({ desde: ini, hasta: y - 1 }); ini = -1 }
  }
  return { bandas, w, h }
}

async function main() {
  const antes = await sharp(ORIGEN).metadata()

  // ── 1 y 2: recortar el aire + negro puro ───────────────────────────────────
  const limpio = await sharp(ORIGEN)
    // El fondo del archivo es un blanco roto (#F4F4F4), no blanco puro: sin
    // tolerancia, `trim` no reconoce el borde y no recorta nada.
    .trim({ threshold: 15 })
    .flatten({ background: '#ffffff' })
    .greyscale()
    // Mapea ~60 → 0 y ~235 → 255: la línea navy queda negra y el fondo, blanco.
    .linear(255 / (235 - 60), (-60 * 255) / (235 - 60))
    .png()
    .toBuffer()

  // ── 3: separar la bajada y agrandarla ──────────────────────────────────────
  const { bandas, w, h } = await bandasEnBlanco(limpio)
  // La última banda ancha es la que separa el lockup de «huellas que no se
  // borran». Se pide un mínimo de alto para no cortar por el hueco que hay
  // entre el halo y la pata.
  const corte = bandas.filter(b => b.hasta - b.desde + 1 >= 8).pop()
  if (!corte || corte.hasta > h - 6) throw new Error('No se encontró la bajada del logo para separarla.')

  const altoPrincipal = corte.desde
  const principal = await sharp(limpio).extract({ left: 0, top: 0, width: w, height: altoPrincipal }).png().toBuffer()
  // La bajada se recorta a su propio ancho: viene con aire a los costados y, si
  // no se saca, al agrandarla el logo entero se ensancha de más.
  const bajada = await sharp(limpio)
    .extract({ left: 0, top: corte.hasta + 1, width: w, height: h - corte.hasta - 1 })
    .trim({ threshold: 10 })
    .png()
    .toBuffer()
  const mb = await sharp(bajada).metadata()

  const bajadaW = Math.round(mb.width! * FACTOR_BAJADA)
  const bajadaH = Math.round(mb.height! * FACTOR_BAJADA)
  const bajadaGrande = await sharp(bajada).resize(bajadaW, bajadaH, { kernel: 'lanczos3' }).png().toBuffer()

  const aire = Math.round(bajadaH * AIRE)
  const anchoFinal = Math.max(w, bajadaW)
  const altoFinal = altoPrincipal + aire + bajadaH

  await sharp({ create: { width: anchoFinal, height: altoFinal, channels: 3, background: '#ffffff' } })
    .composite([
      { input: principal, left: Math.round((anchoFinal - w) / 2), top: 0 },
      { input: bajadaGrande, left: Math.round((anchoFinal - bajadaW) / 2), top: altoPrincipal + aire },
    ])
    .png({ compressionLevel: 9 })
    .toFile(DESTINO)

  const fin = await sharp(DESTINO).metadata()
  const altoEnEtiqueta = 11.29   // mm que mide el logo en la etiqueta de 80 × 50
  console.log(`origen  : ${antes.width} x ${antes.height}`)
  console.log(`recorte : ${w} x ${h}`)
  console.log(`bajada  : ${mb.width} x ${mb.height} -> ${bajadaW} x ${bajadaH} (x${FACTOR_BAJADA})`)
  console.log(`final   : ${fin.width} x ${fin.height}  (proporcion ${(fin.width! / fin.height!).toFixed(2)})`)
  console.log(`en la etiqueta la bajada mide ${(bajadaH / altoFinal * altoEnEtiqueta).toFixed(2)} mm de alto`)
  console.log(`listo   : ${DESTINO}`)
}

main()
