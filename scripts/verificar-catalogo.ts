import './_env-preload'
import { writeFileSync } from 'node:fs'
import { getSheetData } from '../lib/datastore'
import { getFromR2, keyFromPublicUrl } from '../lib/cloudflare-r2'

/**
 * ¿EL CATÁLOGO SALE CON SUS FOTOS?
 *
 *   npx tsx scripts/verificar-catalogo.ts [salida.pdf]
 *
 * El 20-08-2026 el catálogo de producción salió con CERO fotos de producto y no
 * hubo un solo error en ninguna parte: `cargarImagen` se tragaba todo con un
 * `catch { return null }` y cada tarjeta salía con un "sin foto". El PDF pesaba
 * 383 KB contra los 1.557 KB del mismo catálogo generado en local, y traía 4
 * imágenes (el logo y el sello, los únicos que no pasan por ese camino) contra 37.
 *
 * Este script cuenta las imágenes REALMENTE embebidas en el PDF, así que un
 * catálogo sin fotos no puede volver a pasar por bueno.
 */

/** Cuenta los XObject de imagen del PDF, que es lo que de verdad se ve. */
function imagenesDelPdf(pdf: Buffer): { total: number; jpeg: number } {
  const s = pdf.toString('latin1')
  return {
    total: (s.match(/\/Subtype\s*\/Image/g) || []).length,
    jpeg: (s.match(/\/DCTDecode/g) || []).length,
  }
}

async function main() {
  const salida = process.argv[2]

  const productos = (await getSheetData('productos')).filter(p => String(p.activo) !== 'FALSE')
  const conFoto = productos.filter(p => String(p.foto_url || '').trim())
  console.log(`productos activos: ${productos.length} · con foto: ${conFoto.length}`)

  // 1) Las fotos tienen que bajarse por la API S3 de R2, no por el host público
  //    pub-*.r2.dev, que Cloudflare limita y no es para producción.
  let porR2 = 0, ajenas = 0, faltantes = 0
  for (const p of conFoto) {
    const url = String(p.foto_url)
    const key = keyFromPublicUrl(url)
    if (!key) { ajenas++; console.log(`  ajena al bucket: ${String(p.nombre).slice(0, 30)} → ${url.slice(0, 80)}`); continue }
    const buf = await getFromR2(key)
    if (buf) porR2++
    else { faltantes++; console.log(`  NO ESTÁ en el bucket: ${String(p.nombre).slice(0, 30)} → ${key}`) }
  }
  console.log(`  por API de R2: ${porR2} · ajenas (van por HTTP): ${ajenas} · faltantes: ${faltantes}`)

  // 2) El PDF de verdad.
  const t0 = Date.now()
  const { generarCatalogoPdf } = await import('../lib/catalogo-generator')
  const pdf = await generarCatalogoPdf()
  const { total, jpeg } = imagenesDelPdf(pdf)
  console.log(`\nPDF: ${(pdf.byteLength / 1024).toFixed(0)} KB en ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  console.log(`  imágenes embebidas: ${total} (JPEG procesadas por sharp: ${jpeg})`)
  if (salida) { writeFileSync(salida, pdf); console.log(`  guardado en ${salida}`) }

  // El logo y el sello no cuentan: son los que sobrevivían al bug. Lo que importa
  // es que las fotos de PRODUCTO estén.
  const esperadas = conFoto.length
  const fallas: string[] = []
  if (total < esperadas) fallas.push(`el PDF trae ${total} imágenes y hay ${esperadas} productos con foto`)
  if (jpeg === 0 && esperadas > 0) fallas.push('ninguna foto pasó por sharp: el catálogo saldría con las tarjetas en blanco')
  if (pdf.byteLength < 400 * 1024) fallas.push(`el PDF pesa ${(pdf.byteLength / 1024).toFixed(0)} KB, muy poco para un catálogo con fotos`)

  if (fallas.length) {
    console.log('\nFALLA:')
    for (const f of fallas) console.log(`  · ${f}`)
    process.exit(1)
  }
  console.log('\nOK — el catálogo sale con sus fotos.')
}

main().catch(e => { console.error(e); process.exit(1) })
