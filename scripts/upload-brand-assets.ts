/**
 * Recorta el margen transparente del logo y del sello y los sube a R2 bajo
 * claves estables, para usarlos como imágenes públicas en todos los correos.
 *
 *   npx tsx scripts/upload-brand-assets.ts
 */
import './_env-preload' // carga env antes de importar libs que la leen al evaluarse
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { uploadToR2 } from '../lib/cloudflare-r2'

const LOGO_SRC = String.raw`G:\Mi unidad\2. Industrias NC\Logo Marca\SIN FONDO\6.png`
const SELLO_SRC = String.raw`C:\Users\Nicolas\Downloads\Sello-AlmaAnimal-Navy (1).png`

async function main() {
  const logoTrim = await sharp(readFileSync(LOGO_SRC)).trim().png().toBuffer()
  const selloTrim = await sharp(readFileSync(SELLO_SRC)).trim().png().toBuffer()

  const mLogo = await sharp(logoTrim).metadata()
  const mSello = await sharp(selloTrim).metadata()
  console.log(`logo recortado: ${mLogo.width}x${mLogo.height}`)
  console.log(`sello recortado: ${mSello.width}x${mSello.height}`)

  const r1 = await uploadToR2(logoTrim, 'brand/logo-alma-animal.png', 'image/png')
  const r2 = await uploadToR2(selloTrim, 'brand/sello-alma-animal.png', 'image/png')
  console.log('LOGO_URL =', r1.url)
  console.log('SELLO_URL =', r2.url)
}

main().catch((e) => { console.error(e); process.exit(1) })
