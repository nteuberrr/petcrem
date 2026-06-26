import './_env-preload'
import { writeFileSync } from 'node:fs'
import { generarInformeCorporativoPdf } from '../lib/informe-corporativo-generator'

async function main() {
  const t0 = Date.now()
  const pdf = await generarInformeCorporativoPdf()
  writeFileSync('informe-test.pdf', pdf)
  console.log(`OK — informe-test.pdf (${(pdf.byteLength / 1024).toFixed(0)} KB) en ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
