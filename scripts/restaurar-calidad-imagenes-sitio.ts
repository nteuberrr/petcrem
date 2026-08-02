/**
 * Recupera la CALIDAD de las imágenes del sitio público (public/sitio/assets).
 *
 *   npx tsx scripts/restaurar-calidad-imagenes-sitio.ts             (simulación)
 *   npx tsx scripts/restaurar-calidad-imagenes-sitio.ts --aplicar
 *
 * Por qué: la pasada de compresión (commit eb149b4) bajó 136 MB → 39 MB, pero se
 * fue de largo — JPEG al 76%, PNG cuantizado a paleta de 256 colores y TODO
 * recortado a 1600 px. Las fotos grandes quedaron con bloques visibles (el héroe
 * de eutanasia pasó de 179 KB a 53 KB) y los PNG con bandas en los degradados.
 *
 * Esto vuelve a partir del ORIGINAL guardado en git (antes de esa compresión) y
 * lo recomprime con una política de calidad primero:
 *   · JPEG  → mozjpeg q88, progresivo, sin recorte bajo 2000 px de ancho
 *   · PNG   → sin paleta (la paleta es lo que produce el bandeado), esfuerzo alto
 * Solo escribe si la imagen mejora respecto de la que está hoy en disco.
 *
 * El nombre y la extensión no cambian: no hay que tocar el HTML ni el CSS.
 */
import './_env-preload'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import sharp from 'sharp'

const DIR = path.join(process.cwd(), 'public', 'sitio', 'assets')
const APLICAR = process.argv.includes('--aplicar')
/** Commit anterior a la compresión agresiva: ahí viven los originales. */
const ORIGEN = 'eb149b4^'
/** Techo de ancho. 2000 px cubre un héroe a pantalla completa en retina sin excesos. */
const ANCHO_MAX = 2000

const mb = (b: number) => (b / 1048576).toFixed(1) + ' MB'
const kb = (b: number) => (b / 1024).toFixed(0).padStart(5) + ' KB'

function original(nombre: string): Buffer | null {
  try {
    return execFileSync('git', ['show', `${ORIGEN}:public/sitio/assets/${nombre}`], { maxBuffer: 300e6 })
  } catch {
    return null   // imagen agregada DESPUÉS de la compresión: ya está en su calidad original
  }
}

/** Sobre este peso una imagen que ya cabe en la pantalla igual conviene recomprimir. */
const PESO_ACEPTABLE = 900 * 1024

async function recomprimir(buf: Buffer, esPng: boolean): Promise<Buffer> {
  const img = sharp(buf, { failOn: 'none' })
  const meta = await img.metadata()
  // Si el original ya entra en el techo de ancho y no pesa de más, se devuelve TAL
  // CUAL: recomprimirlo solo volvería a perder calidad sin ganar nada.
  if ((meta.width || 0) <= ANCHO_MAX && buf.length <= PESO_ACEPTABLE) return buf
  const pipe = (meta.width || 0) > ANCHO_MAX
    ? img.resize({ width: ANCHO_MAX, withoutEnlargement: true, kernel: 'lanczos3' })
    : img
  return esPng
    // Sin `palette`: cuantizar a 256 colores es lo que dejaba bandas en los cielos
    // y en los degradados de las imágenes generadas.
    ? pipe.png({ compressionLevel: 9, effort: 10 }).toBuffer()
    // q85 con submuestreo de color por defecto (4:2:0): en fotografía es
    // indistinguible de 4:4:4 y pesa un tercio menos. Lo que se ve mal a q76 son
    // los bloques de luminancia, y eso lo arregla la calidad, no el croma.
    : pipe.jpeg({ quality: 85, mozjpeg: true, progressive: true }).toBuffer()
}

async function main() {
  const archivos = (await fs.readdir(DIR)).filter(f => /\.(jpe?g|png)$/i.test(f))
  let hoy = 0, nuevo = 0, tocadas = 0
  const detalle: Array<[string, number, number, string]> = []

  for (const f of archivos) {
    const actual = await fs.readFile(path.join(DIR, f))
    hoy += actual.length
    const orig = original(f)
    if (!orig) { nuevo += actual.length; continue }

    try {
      const out = await recomprimir(orig, /\.png$/i.test(f))
      const dims = await sharp(out).metadata()
      // Solo vale la pena si el resultado tiene MÁS información que lo que hay hoy
      // (más bytes = menos artefactos, a igual o mayor resolución).
      if (out.length > actual.length * 1.05) {
        detalle.push([f, actual.length, out.length, `${dims.width}x${dims.height}`])
        nuevo += out.length
        tocadas++
        if (APLICAR) await fs.writeFile(path.join(DIR, f), out)
      } else {
        nuevo += actual.length
      }
    } catch (e) {
      nuevo += actual.length
      console.error('  ! no se pudo procesar', f, (e as Error).message)
    }
  }

  detalle.sort((a, b) => (b[2] - b[1]) - (a[2] - a[1]))
  console.log(`${APLICAR ? 'APLICADO' : 'SIMULACIÓN'} — ${tocadas} de ${archivos.length} imágenes recuperadas\n`)
  for (const [f, a, d, dim] of detalle.slice(0, 20)) {
    console.log(` ${kb(a)} → ${kb(d)}  ${dim.padEnd(10)} ${f.slice(0, 60)}`)
  }
  console.log(`\n TOTAL: ${mb(hoy)} → ${mb(nuevo)}`)
  if (!APLICAR) console.log('\n Repetí con --aplicar para escribir los archivos.')
}

main().catch(e => { console.error('ERROR:', e instanceof Error ? e.message : e); process.exit(1) })
