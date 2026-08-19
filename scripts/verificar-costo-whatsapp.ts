import './_env-preload'
import { costosWhatsapp } from '../lib/whatsapp-costos'
import { resumenEnviosWa } from '../lib/uso-whatsapp'

/**
 * Cuánto nos cobró Meta por WhatsApp, de su propia contabilidad.
 *
 *   npx tsx scripts/verificar-costo-whatsapp.ts [dias]
 *
 * Existe porque el consumo de WhatsApp era el único punto ciego de la revisión de
 * costos: la IA estaba medida al detalle y de acá no sabíamos nada. Resulta que
 * Meta sí lo expone —`pricing_analytics` de la WABA— pero con dos trampas que
 * hacen parecer que no hay datos: el campo NO existe en v22 (hay que pedirlo en
 * v23) y `dimensions` es obligatorio. En ambos casos responde 200 con solo el id.
 */

async function main() {
  const dias = Math.max(1, parseInt(process.argv[2] || '30', 10) || 30)
  const c = await costosWhatsapp(dias)

  if (!c.ok) { console.log('No se pudo consultar a Meta:', c.error); process.exit(1) }

  const plata = (n: number) => c.moneda === 'CLP' ? '$' + Math.round(n).toLocaleString('es-CL') : `${n.toFixed(2)} ${c.moneda}`
  console.log(`META — facturación de WhatsApp · ${c.desde} → ${c.hasta} (${dias} días)\n`)
  console.log('  categoría'.padEnd(20) + 'mensajes'.padStart(10) + 'costo'.padStart(14) + 'c/u'.padStart(10))
  for (const x of c.porCategoria) {
    const cu = x.costo === 0 ? 'sin cargo' : plata(x.costo / Math.max(1, x.mensajes))
    console.log('  ' + x.categoria.padEnd(18) + String(x.mensajes).padStart(10) + (x.costo === 0 ? '—' : plata(x.costo)).padStart(14) + cu.padStart(10))
  }
  console.log('  ' + '-'.repeat(50))
  console.log('  TOTAL'.padEnd(20) + ''.padStart(10) + plata(c.total).padStart(14))

  if (c.gratis > 0) {
    console.log(`\n  ⚠ ${c.gratis.toLocaleString('es-CL')} mensajes van sin cargo por la ventana de 24 h.`)
    console.log('    Meta vuelve a cobrarlos el 01-10-2026: ese es el volumen que hoy no pagamos.')
  }

  const e = await resumenEnviosWa(dias)
  console.log(`\nNUESTRO REGISTRO — ${e.total.toLocaleString('es-CL')} envíos anotados${e.fallidos ? `, ${e.fallidos} rechazados` : ''}`)
  if (e.total === 0) {
    console.log('  (vacío: se llena con los envíos nuevos; si la tabla no existe, correr supabase/uso-whatsapp.sql)')
  } else {
    for (const p of e.porPlantilla) console.log('   ' + p.plantilla.padEnd(30) + p.categoria.padEnd(12) + String(p.n).padStart(6))
  }
}

main().catch(e => { console.error(e); process.exit(1) })
