import './_env-preload'
import { getSheetData } from '../lib/datastore'
import { listarReglas, devengarComisionDeFicha } from '../lib/comisiones'
import { fmtPrecio } from '../lib/format'

/**
 * Devenga las comisiones que quedaron sin registrar.
 *
 * Por qué (dueño 2026-08-19): el devengo colgaba de la emisión de la BOLETA, así
 * que una ficha de un vet con comisión que se pagó sin boletearse —marcada «no
 * emitir boleta por este servicio», o simplemente nunca boleteada a mano— no le
 * generaba comisión al veterinario aunque el servicio se cobró. Ahora el
 * disparador es el PAGO; esto recorre lo viejo con la regla nueva.
 *
 *   npx tsx scripts/backfill-comisiones.ts            # solo lista (dry-run)
 *   npx tsx scripts/backfill-comisiones.ts --aplicar  # las devenga
 *
 * Es idempotente (`cliente_id` es único en `comisiones`): correrlo dos veces no
 * duplica nada.
 */

const APLICAR = process.argv.includes('--aplicar')

async function main() {
  const [reglas, clientes, comisiones, vets] = await Promise.all([
    listarReglas(),
    getSheetData('clientes'),
    getSheetData('comisiones').catch(() => [] as Record<string, string>[]),
    getSheetData('veterinarios').catch(() => [] as Record<string, string>[]),
  ])
  const activas = new Set(reglas.filter(r => r.activo).map(r => r.veterinaria_id))
  if (activas.size === 0) { console.log('No hay veterinarias con comisión activa.'); return }
  const nombreVet = new Map(vets.map(v => [String(v.id), String(v.nombre || '')]))
  const yaDevengada = new Set(comisiones.filter(c => String(c.estado || '') === 'devengada').map(c => String(c.cliente_id)))

  const candidatas = clientes.filter(c =>
    activas.has(String(c.veterinaria_id || '')) &&
    String(c.estado || '') !== 'borrador' &&
    !!String(c.codigo || '').trim() &&
    String(c.estado_pago || '').toLowerCase() === 'pagado' &&
    !yaDevengada.has(String(c.id)),
  )

  if (candidatas.length === 0) { console.log('No hay comisiones pendientes de devengar. Todo al día.'); return }

  console.log(`Fichas pagadas SIN comisión devengada: ${candidatas.length}\n`)
  for (const c of candidatas) {
    const marca = String(c.sin_boleta || '').toUpperCase() === 'TRUE' ? ' · sin boleta'
      : String(c.boleta_id || '').trim() ? ` · boleta ${c.boleta_id}` : ' · sin boletear'
    console.log(`  ${c.codigo} — ${c.nombre_mascota} (${nombreVet.get(String(c.veterinaria_id)) || c.veterinaria_id})${marca}`)
  }

  if (!APLICAR) { console.log('\n(dry-run) Vuelve a correrlo con --aplicar para devengarlas.'); return }

  let ok = 0
  let total = 0
  for (const c of candidatas) {
    const r = await devengarComisionDeFicha(c)
    if (r.devengada) { ok++; total += r.monto ?? 0; console.log(`  ✓ ${c.codigo}: ${fmtPrecio(r.monto ?? 0)}`) }
    else console.log(`  – ${c.codigo}: no correspondía`)
  }
  console.log(`\nDevengadas: ${ok}/${candidatas.length} · ${fmtPrecio(total)}`)
}

main().catch(e => { console.error(e); process.exit(1) })
