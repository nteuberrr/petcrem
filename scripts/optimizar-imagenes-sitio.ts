/**
 * Optimiza las imágenes del sitio público (public/sitio/assets) EN EL MISMO PATH.
 *
 *   npx tsx scripts/optimizar-imagenes-sitio.ts            (simulación, no escribe)
 *   npx tsx scripts/optimizar-imagenes-sitio.ts --aplicar
 *
 * Por qué: el export de Webflow trajo las fotos sin comprimir — la home llegó a
 * pesar ~37 MB en móvil (36 imágenes, varias de 2–3 MB). Eso se paga dos veces:
 * en la conversión (el 96% del tráfico de Ads es celular) y en el Ad Rank, donde
 * la "experiencia de la página de destino" venía AVERAGE.
 *
 * Se recomprime conservando nombre y extensión → CERO cambios en el HTML de las
 * plantillas. Solo se reemplaza el archivo si el resultado es más liviano; si algo
 * sale mal, `git checkout public/sitio/assets` lo devuelve todo.
 */
import './_env-preload'
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const DIR = path.join(process.cwd(), 'public', 'sitio', 'assets')
const APLICAR = process.argv.includes('--aplicar')
// ⚠️ Estos números ya se pasaron una vez: con 1600 px, JPEG q76 y PNG con paleta
// las fotos grandes quedaron con bloques visibles y los degradados con bandas
// (hubo que recuperarlas con scripts/restaurar-calidad-imagenes-sitio.ts). Si
// hace falta bajar más el peso, la salida son formatos modernos (WebP/AVIF), no
// seguir apretando la calidad.
const ANCHO_MAX = 2000          // techo: un héroe a pantalla completa en retina
const MINIMO = 120 * 1024       // por debajo de 120 KB no vale la pena tocarla

const kb = (b: number) => (b / 1024).toFixed(0).padStart(6) + ' KB'

async function main() {
  const archivos = (await fs.readdir(DIR)).filter(f => /\.(jpe?g|png)$/i.test(f))
  let antes = 0, despues = 0, tocadas = 0
  const detalle: Array<[string, number, number]> = []

  for (const f of archivos) {
    const full = path.join(DIR, f)
    const orig = await fs.readFile(full)
    antes += orig.length
    if (orig.length < MINIMO) { despues += orig.length; continue }

    try {
      const img = sharp(orig, { failOn: 'none' })
      const meta = await img.metadata()
      const necesitaResize = (meta.width || 0) > ANCHO_MAX
      let pipe = necesitaResize ? img.resize({ width: ANCHO_MAX, withoutEnlargement: true }) : img
      pipe = /\.png$/i.test(f)
        // Sin `palette`: cuantizar a 256 colores es lo que dejaba bandeado.
        ? pipe.png({ compressionLevel: 9, effort: 10 })
        : pipe.jpeg({ quality: 85, mozjpeg: true, progressive: true })
      const out = await pipe.toBuffer()

      if (out.length < orig.length * 0.92) {
        detalle.push([f, orig.length, out.length])
        despues += out.length
        tocadas++
        if (APLICAR) await fs.writeFile(full, out)
      } else {
        despues += orig.length
      }
    } catch (e) {
      despues += orig.length
      console.error('  ! no se pudo procesar', f, (e as Error).message)
    }
  }

  detalle.sort((a, b) => (b[1] - b[2]) - (a[1] - a[2]))
  console.log(`${APLICAR ? 'OPTIMIZADAS' : 'SIMULACIÓN'} — ${tocadas} de ${archivos.length} imágenes\n`)
  for (const [f, a, d] of detalle.slice(0, 15)) {
    console.log(` ${kb(a)} → ${kb(d)}  (-${Math.round((1 - d / a) * 100)}%)  ${f.slice(0, 70)}`)
  }
  console.log(`\n TOTAL: ${(antes / 1048576).toFixed(1)} MB → ${(despues / 1048576).toFixed(1)} MB` +
    `  (-${Math.round((1 - despues / antes) * 100)}%)`)
  if (!APLICAR) console.log('\n Repetí con --aplicar para escribir los archivos.')
}

main().catch(e => { console.error('ERROR:', e instanceof Error ? e.message : e); process.exit(1) })
