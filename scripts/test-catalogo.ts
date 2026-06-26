import './_env-preload'
import { writeFileSync } from 'node:fs'
import { generarCatalogoPdf } from '../lib/catalogo-generator'

async function main() {
  const t0 = Date.now()
  const pdf = await generarCatalogoPdf()
  const out = 'catalogo-test.pdf'
  writeFileSync(out, pdf)
  console.log(`OK — ${out} (${(pdf.byteLength / 1024).toFixed(0)} KB) en ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
