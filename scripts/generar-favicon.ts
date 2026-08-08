/**
 * Genera `app/favicon.ico` a partir de `app/icon.svg` (la huella de marca).
 *
 *   npx tsx scripts/generar-favicon.ts
 *
 * El .ico que traía el proyecto era el de Next/Vercel. Lo reemplaza por el
 * nuestro para los navegadores y herramientas que piden /favicon.ico directo,
 * mientras que el SVG cubre a los modernos (se ve nítido en cualquier tamaño).
 *
 * El ICO se arma a mano: la especificación permite meter un PNG tal cual dentro
 * del contenedor (soportado desde Vista), así que basta la cabecera ICONDIR + una
 * ICONDIRENTRY apuntando al PNG. Evita sumar una dependencia solo para esto.
 */
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import sharp from 'sharp'

const RAIZ = join(__dirname, '..')
const SVG = join(RAIZ, 'app', 'icon.svg')
const ICO = join(RAIZ, 'app', 'favicon.ico')
/** 48 px cubre bien la pestaña, la barra de favoritos y el acceso directo. */
const LADO = 48

function envolverEnIco(png: Buffer, lado: number): Buffer {
  const dir = Buffer.alloc(6)
  dir.writeUInt16LE(0, 0)   // reservado
  dir.writeUInt16LE(1, 2)   // tipo: 1 = icono
  dir.writeUInt16LE(1, 4)   // cantidad de imágenes

  const entrada = Buffer.alloc(16)
  entrada.writeUInt8(lado >= 256 ? 0 : lado, 0)  // ancho (0 = 256)
  entrada.writeUInt8(lado >= 256 ? 0 : lado, 1)  // alto
  entrada.writeUInt8(0, 2)                       // colores de la paleta
  entrada.writeUInt8(0, 3)                       // reservado
  entrada.writeUInt16LE(1, 4)                    // planos
  entrada.writeUInt16LE(32, 6)                   // bits por pixel
  entrada.writeUInt32LE(png.length, 8)           // tamaño de la imagen
  entrada.writeUInt32LE(dir.length + entrada.length, 12) // offset de los datos

  return Buffer.concat([dir, entrada, png])
}

async function main() {
  const svg = readFileSync(SVG)
  const png = await sharp(svg).resize(LADO, LADO).png().toBuffer()
  writeFileSync(ICO, envolverEnIco(png, LADO))
  console.log(`favicon.ico regenerado desde icon.svg (${LADO}×${LADO}, ${png.length} bytes de PNG)`)
}

main().catch(e => { console.error(e); process.exit(1) })
