import './_env-preload'
import { generarPieza } from '../lib/marketing-pieza'

async function main() {
  const id = process.argv[2] || '11'
  const t0 = Date.now()
  const r = await generarPieza(id, 'diagnostico')
  console.log(`--- pieza #${id} (${((Date.now() - t0) / 1000).toFixed(1)}s) ---`)
  console.log('estado:', r.item.estado, '| canal:', r.item.canal)
  console.log('len cuerpo:', (r.item.cuerpo || '').length)
  console.log('imagen_url:', r.item.imagen_url || '(vacío)')
  console.log('imagenes_json:', r.item.imagenes_json || '(vacío)')
  console.log('AVISOS:', r.avisos.length ? r.avisos : '(ninguno)')
}
main().then(() => process.exit(0)).catch(e => { console.error('ERROR:', e); process.exit(1) })
