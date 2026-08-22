import './_env-preload'
import { getSheetData } from '../lib/datastore'
import { formatDateForSheet } from '../lib/dates'

/**
 * PUBLICA LAS DESPEDIDAS QUE SE PERDIERON.
 *
 *   npx tsx scripts/publicar-memoriales-pendientes.ts            (simulación)
 *   npx tsx scripts/publicar-memoriales-pendientes.ts --aplicar
 *
 * La historia de Instagram sale sola al ENTREGAR la mascota, y ese disparador no
 * vuelve a pasar: si falla, la despedida se pierde para siempre. Del 19 al
 * 22-08-2026 falló en todas —sharp dejó de funcionar en producción— y quedaron
 * 13 tutores que habían pedido expresamente que publicáramos a su mascota.
 *
 * Esto las publica a mano. Es la MISMA función que corre al entregar
 * (`publicarMemorialSiCorresponde`), así que revalida el consentimiento y la
 * entrega, y es idempotente: una ficha ya publicada no se toca.
 *
 * ⚠️ PUBLICA EN LA CUENTA REAL de Instagram. Cada ficha es una historia visible
 * para todo el mundo, así que el modo por defecto solo LISTA. Y las historias
 * salen todas juntas: si son muchas, conviene hacerlo por tandas con `--max`.
 */

const PAUSA_MS = 4000

async function main() {
  const aplicar = process.argv.includes('--aplicar')
  const max = parseInt(process.argv.find(a => a.startsWith('--max='))?.split('=')[1] || '0', 10) || Infinity

  const [clientes, despachos] = await Promise.all([
    getSheetData('clientes'),
    getSheetData('despachos').catch(() => [] as Record<string, string>[]),
  ])
  const entregaDe = new Map<string, string>()
  for (const d of despachos) {
    let e: Record<string, { fecha_hora?: string }> = {}
    try { e = JSON.parse(d.entregas || '{}') } catch { /* ruta sin entregas */ }
    for (const [cid, v] of Object.entries(e)) {
      entregaDe.set(String(cid), String(v?.fecha_hora || '').slice(0, 10) || formatDateForSheet(d.fecha_realizada) || '')
    }
  }

  const pendientes = clientes
    .filter(c => String(c.memorial_consentimiento || '').toUpperCase() === 'TRUE')
    .filter(c => !String(c.memorial_publicado_at || '').trim())
    .filter(c => String(c.estado || '').toLowerCase() === 'despachado')
    .sort((a, b) => (entregaDe.get(String(a.id)) || '').localeCompare(entregaDe.get(String(b.id)) || ''))

  console.log(aplicar ? '\nPUBLICANDO\n' : '\nSIMULACIÓN (agregá --aplicar para publicar de verdad)\n')
  console.log(`${pendientes.length} despedida(s) con permiso, entregadas y sin publicar:\n`)
  for (const c of pendientes) {
    console.log(`  ${String(c.codigo || '').padEnd(11)} ${String(c.nombre_mascota || '').slice(0, 20).padEnd(22)} entregada ${entregaDe.get(String(c.id)) || '—'}`)
  }
  if (!pendientes.length) { console.log('  (nada que hacer)\n'); return }

  if (!aplicar) {
    console.log(`\nNada publicado. Con --aplicar se publican ${Math.min(pendientes.length, max)} historia(s) en la cuenta REAL.`)
    console.log('Usá --max=N para hacerlo por tandas.\n')
    return
  }

  const { publicarMemorialSiCorresponde } = await import('../lib/memorial')
  let ok = 0, fallo = 0
  console.log('')
  for (const [i, c] of pendientes.slice(0, max === Infinity ? undefined : max).entries()) {
    if (i > 0) await new Promise(r => setTimeout(r, PAUSA_MS))
    const r = await publicarMemorialSiCorresponde(String(c.id))
    if (r.ok) { ok++; console.log(`  ✅ ${c.codigo} ${c.nombre_mascota} → ${r.plantilla} · ${r.storyId}`) }
    else { fallo++; console.log(`  ❌ ${c.codigo} ${c.nombre_mascota}: ${r.motivo}`) }
  }
  console.log(`\n${ok} publicada(s) · ${fallo} con problema`)
  // La destacada "Despedidas" NO se puede tocar por API (Meta no lo expone).
  if (ok) console.log('Recordá fijarlas a mano en la destacada «Despedidas» mientras las historias estén vivas (24 h).\n')
}

main().catch(e => { console.error(e); process.exit(1) })
