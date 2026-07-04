import './_env-preload'
import { generarPieza } from '../lib/marketing-pieza'

/**
 * Regenera piezas del calendario por id (uso puntual, manual):
 *   npx tsx scripts/regenerar-piezas.ts 36 37
 * Mantiene el estado (programada sigue programada) y pisa copy + imágenes con
 * las reglas vigentes (memoria de variedad, 4:5 en Instagram, anti-monotonía).
 */
async function main() {
  const ids = process.argv.slice(2).filter(a => /^\d+$/.test(a))
  if (ids.length === 0) {
    console.error('Uso: npx tsx scripts/regenerar-piezas.ts <id> [<id> ...]')
    process.exit(1)
  }
  for (const id of ids) {
    console.log(`\n=== Regenerando pieza #${id} ===`)
    try {
      const r = await generarPieza(id, 'regeneracion-manual')
      console.log(`OK #${id} (${r.item.canal}, estado ${r.item.estado})`)
      const imgs = r.item.imagenes_json ? JSON.parse(r.item.imagenes_json) as { url: string }[] : (r.item.imagen_url ? [{ url: r.item.imagen_url }] : [])
      imgs.forEach((im, i) => console.log(`  slide ${i + 1}: ${im.url}`))
      console.log(`  estilo: ${r.item.estilo || '(sin estilo)'}`)
      for (const a of r.avisos) console.log(`  aviso: ${a}`)
    } catch (e) {
      console.error(`FALLÓ #${id}:`, e instanceof Error ? e.message : e)
    }
  }
}

main()
