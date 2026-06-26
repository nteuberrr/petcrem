/**
 * Sube las fuentes de marca (More Sugar + Inter) a R2 bajo claves estables, para
 * que el renderer de gráficos (lib/grafico-render.ts) las cargue en runtime sin
 * depender del file-tracing de Next en serverless.
 *
 *   npx tsx scripts/upload-fonts.ts
 */
import './_env-preload' // carga env antes de importar libs que la leen al evaluarse
import { readFileSync } from 'node:fs'
import { uploadToR2 } from '../lib/cloudflare-r2'

const FONTS = [
  { path: 'assets/fonts/MoreSugar-Regular.otf', key: 'brand/fonts/MoreSugar-Regular.otf', ct: 'font/otf' },
  { path: 'assets/fonts/Inter-Regular.woff', key: 'brand/fonts/Inter-Regular.woff', ct: 'font/woff' },
  { path: 'assets/fonts/Inter-SemiBold.woff', key: 'brand/fonts/Inter-SemiBold.woff', ct: 'font/woff' },
  { path: 'assets/fonts/Inter-Bold.woff', key: 'brand/fonts/Inter-Bold.woff', ct: 'font/woff' },
]

async function main() {
  for (const f of FONTS) {
    const buf = readFileSync(f.path)
    const up = await uploadToR2(buf, f.key, f.ct)
    console.log(`${f.key} -> ${up.url} (${buf.byteLength} bytes)`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
