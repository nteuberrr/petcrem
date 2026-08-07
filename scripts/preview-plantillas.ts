import './_env-preload'
import fs from 'fs/promises'
import path from 'path'
import sharp from 'sharp'
import { construirPlantilla, PLANTILLAS, type SlotsPlantilla, type NombrePlantilla } from '../lib/marketing-plantillas'
import { renderGraficoHTML } from '../lib/grafico-render'
import { listarImagenes } from '../lib/mailing-images'
import { esLogo } from '../lib/marca-logo'
import { MUESTRAS_PLANTILLAS as MUESTRAS } from './muestras-plantillas'

/**
 * CATÁLOGO VISUAL de las plantillas maestras: renderiza TODAS con contenido de
 * muestra y deja los PNG en `.preview-plantillas/` + un index.html para verlas
 * todas juntas.
 *
 *   npx tsx scripts/preview-plantillas.ts            → todas, post_vertical
 *   npx tsx scripts/preview-plantillas.ts story      → en otro formato
 *
 * NO genera fotos con IA (costaría plata y tarda): reutiliza fotos reales del
 * banco para los slots FOTO:*, así se ve exactamente cómo queda cada layout.
 */

const FORMATO = process.argv[2] || 'post_vertical'
const OUT = path.join(process.cwd(), '.preview-plantillas')


async function main() {
  await fs.mkdir(OUT, { recursive: true })
  const banco = await listarImagenes().catch(() => [])
  const logos = banco.filter(esLogo)
  const logoBlanco = logos.find(l => /blanc|white/i.test(`${l.descripcion} ${l.tags}`))?.url || logos[0]?.url
  const logoNavy = logos.find(l => /navy|azul/i.test(`${l.descripcion} ${l.tags}`))?.url || logos[0]?.url

  // Fotos reales del banco para los slots (sin gastar en generación IA).
  const mascotas = banco.filter(i => i.grupo === 'mascotas' && i.url && !esLogo(i)).map(i => i.url)
  if (!mascotas.length) console.warn('⚠ El banco no tiene fotos del grupo "mascotas": las plantillas con foto saldrán vacías.')
  const fotoRota = (n: number) => mascotas[n % Math.max(1, mascotas.length)] || ''

  const hechas: { nombre: string; titulo: string; archivo: string; w: number; h: number }[] = []
  let usadas = 0
  for (const nombre of PLANTILLAS) {
    const m = MUESTRAS[nombre]
    try {
      const { html, fotos } = construirPlantilla(nombre, m.slots, { formato: FORMATO, logoBlanco, logoNavy })
      // Sustituir los placeholders FOTO:slot por fotos reales del banco.
      let final = html
      for (const f of fotos) final = final.split(`FOTO:${f.slot}`).join(fotoRota(usadas++))
      const w = parseInt(final.match(/width:(\d+)px/)?.[1] || '1080', 10)
      const h = parseInt(final.match(/height:(\d+)px/)?.[1] || '1350', 10)
      const { buffer } = await renderGraficoHTML({ html: final, width: w, height: h })
      const archivo = `${nombre}.png`
      await fs.writeFile(path.join(OUT, archivo), buffer)
      hechas.push({ nombre, titulo: m.titulo, archivo, w, h })
      console.log(`✓ ${nombre}`)
    } catch (e) {
      console.error(`✗ ${nombre}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Miniaturas + index.html para verlas todas juntas.
  const cards: string[] = []
  for (const h of hechas) {
    const thumb = await sharp(path.join(OUT, h.archivo)).resize({ width: 460 }).jpeg({ quality: 82 }).toBuffer()
    cards.push(`<figure><img src="data:image/jpeg;base64,${thumb.toString('base64')}" alt="${h.nombre}"><figcaption><b>${h.nombre}</b><br>${h.titulo}</figcaption></figure>`)
  }
  const index = `<!doctype html><meta charset="utf-8"><title>Plantillas Alma Animal</title>
<style>body{background:#143C64;color:#fff;font:15px/1.4 system-ui;margin:0;padding:32px}
h1{font-size:24px;margin:0 0 24px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:28px}
figure{margin:0}img{width:100%;border-radius:10px;display:block}figcaption{margin-top:8px;font-size:13px;color:#e8eef5}</style>
<h1>Plantillas maestras — ${hechas.length} de ${PLANTILLAS.length} (${FORMATO})</h1><main>${cards.join('')}</main>`
  await fs.writeFile(path.join(OUT, 'index.html'), index, 'utf8')
  console.log(`\n${hechas.length}/${PLANTILLAS.length} renderizadas → ${OUT}\\index.html`)
}

main().catch(e => { console.error(e); process.exit(1) })
