import './_env-preload'
import { editarImagenPieza } from '../lib/marketing-pieza'
import { getSheetData } from '../lib/datastore'

async function main() {
  const id = process.argv[2] || '11'
  const idx = parseInt(process.argv[3] || '2', 10)
  const instr = process.argv[4] || 'Cambiá el texto del cuerpo para que diga que nuestras instalaciones son propias y certificadas, con horno bajo norma ISO.'
  const t0 = Date.now()
  const r = await editarImagenPieza(id, instr, idx, 'diagnostico')
  console.log(`--- editar #${id} slide ${idx} (${((Date.now() - t0) / 1000).toFixed(1)}s) ---`)
  console.log('avisos:', r.avisos.length ? r.avisos : '(ninguno)')
  const imgs = JSON.parse(r.item.imagenes_json || '[]') as { url: string }[]
  console.log('total slides:', imgs.length)
  const banco = await getSheetData('mailing_imagenes')
  imgs.forEach((im, i) => {
    const b = banco.find(x => x.url === im.url)
    console.log(`  slide ${i + 1}: codigo=${b?.codigo || '?'} modelo=${b?.modelo || '?'} ${i + 1 === idx ? '  <-- EDITADA' : ''}`)
  })
}
main().then(() => process.exit(0)).catch(e => { console.error('ERROR:', e); process.exit(1) })
