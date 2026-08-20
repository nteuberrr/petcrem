import './_env-preload'
import { getSheetData, updateByIdIf } from '../lib/datastore'
import { activarIndexado, origenDeVet } from '../lib/precios-indexados'
import { boletaAlCliente } from '../lib/vet-boleta'

/**
 * ENCIENDE "BOLETA AL CLIENTE" EN LOS CONVENIOS QUE YA FUNCIONABAN ASÍ.
 *
 *   npx tsx scripts/backfill-boleta-al-cliente.ts            (simulación)
 *   npx tsx scripts/backfill-boleta-al-cliente.ts --aplicar
 *
 * Correr DESPUÉS del `supabase/boleta-al-cliente.sql` y ANTES de desplegar: hasta
 * este cambio el modelo de cobro se deducía de la comisión activa, y el código
 * nuevo lo lee del flag. Si se despliega con el flag en FALSE, las fichas de Manuel
 * dejan de boletearse al tutor y se cuelan a su propuesta de factura mensual.
 *
 * Dos convenios (decisión del dueño, 2026-08-19):
 *  · Manuel Astorga — ya operaba así vía su comisión de $20.000. Solo formaliza.
 *  · Veterinaria Cafati — pasa al mismo modelo y su tabla se indexa a los precios
 *    GENERALES, así al tutor se le cobra precio de lista. Ojo: su tabla propia
 *    estaba POR ENCIMA de la general, así que sus tarifas BAJAN.
 *
 * Es idempotente: correrlo dos veces no cambia nada la segunda.
 */

interface Objetivo {
  id: string
  nombre: string
  /** Indexar su tabla de precios especiales a esta base, o null para no tocarla. */
  indexar: 'general' | null
}

const OBJETIVOS: Objetivo[] = [
  { id: '15', nombre: 'Manuel Enrique Astorga Rogazy', indexar: null },      // ya está indexado a general
  { id: '1', nombre: 'Veterinaria Cafati', indexar: 'general' },
]

async function main() {
  const aplicar = process.argv.includes('--aplicar')
  const vets = await getSheetData('veterinarios')

  console.log(aplicar ? '\nAPLICANDO\n' : '\nSIMULACIÓN (agregá --aplicar para escribir)\n')

  for (const o of OBJETIVOS) {
    const v = vets.find(r => String(r.id) === o.id)
    if (!v) { console.log(`  #${o.id} ${o.nombre}: NO EXISTE — se omite`); continue }
    // El nombre se compara para no marcar al vet equivocado si los ids cambiaran.
    if (String(v.nombre).trim() !== o.nombre) {
      console.log(`  #${o.id}: el nombre no calza ("${v.nombre}" ≠ "${o.nombre}") — se omite por seguridad`)
      continue
    }

    console.log(`  #${o.id} ${v.nombre}`)

    if (boletaAlCliente(v)) {
      console.log('     boleta al cliente: ya estaba encendida')
    } else if (aplicar) {
      await updateByIdIf('veterinarios', o.id, {}, { boleta_al_cliente: 'TRUE' })
      console.log('     boleta al cliente: FALSE → TRUE')
    } else {
      console.log('     boleta al cliente: FALSE → TRUE (simulado)')
    }

    if (o.indexar) {
      const actual = origenDeVet(v)
      if (actual === o.indexar) {
        console.log(`     precios: ya indexados a ${o.indexar}`)
      } else if (aplicar) {
        const r = await activarIndexado(o.id, o.indexar)
        console.log(`     precios: ${actual ?? 'tarifa propia'} → indexados a ${o.indexar} (${r.tramos} tramos copiados)`)
      } else {
        console.log(`     precios: ${actual ?? 'tarifa propia'} → indexados a ${o.indexar} (simulado)`)
      }
    }
  }

  console.log(aplicar
    ? '\nListo. Verificá con: npx tsx scripts/verificar-boleta-al-cliente.ts'
    : '\nNada escrito.')
}

main().catch(e => { console.error(e); process.exit(1) })
