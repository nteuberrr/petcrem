import './_env-preload'
import { editarImagenPieza } from '../lib/marketing-pieza'

// Uso puntual: npx tsx scripts/fix-slide.ts <itemId> <indice> "<instrucción>"
async function main() {
  const [id, indice, instruccion] = process.argv.slice(2)
  if (!id || !indice || !instruccion) {
    console.error('Uso: npx tsx scripts/fix-slide.ts <itemId> <indice> "<instrucción>"')
    process.exit(1)
  }
  const r = await editarImagenPieza(id, instruccion, parseInt(indice, 10), 'ajuste-manual')
  const imgs = r.item.imagenes_json ? JSON.parse(r.item.imagenes_json) as { url: string }[] : []
  imgs.forEach((im, i) => console.log(`slide ${i + 1}: ${im.url}`))
  for (const a of r.avisos) console.log('aviso:', a)
}

main()
