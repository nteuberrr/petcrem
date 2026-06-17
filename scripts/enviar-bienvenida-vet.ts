/**
 * Envía el correo REAL de "Bienvenida al convenio" a una veterinaria YA
 * registrada (a su propio correo), útil para las que se ingresaron antes de que
 * existiera el envío automático. Busca por nombre o contacto; solo envía si hay
 * UNA coincidencia (si hay 0 o varias, aborta y lista, para no escribirle a la
 * veterinaria equivocada).
 *
 *   npx tsx scripts/enviar-bienvenida-vet.ts "<nombre o contacto>"
 *   (ej.  npx tsx scripts/enviar-bienvenida-vet.ts guajardo )
 */
import './_env-preload' // DEBE ir primero: carga env antes de evaluar las libs
import { getSheetData } from '../lib/datastore'
import { enviarBienvenidaConvenioVet } from '../lib/vet-cremacion-mailer'

const Q = (process.argv[2] || '').trim().toLowerCase()

async function main() {
  if (!Q) { console.error('Uso: npx tsx scripts/enviar-bienvenida-vet.ts "<nombre o contacto>"'); process.exit(1) }
  const vets = await getSheetData('veterinarios')
  const matches = vets.filter(v =>
    (v.nombre || '').toLowerCase().includes(Q) || (v.nombre_contacto || '').toLowerCase().includes(Q))

  if (matches.length === 0) { console.error(`No encontré veterinaria que coincida con "${Q}".`); process.exit(1) }
  if (matches.length > 1) {
    console.error(`Hay ${matches.length} coincidencias para "${Q}":`)
    matches.forEach(v => console.error(`  - ${v.nombre} · ${v.nombre_contacto} · ${v.correo}`))
    console.error('Afiná la búsqueda para que coincida solo una.')
    process.exit(1)
  }

  const v = matches[0]
  if (!v.correo || !/\S+@\S+\.\S+/.test(v.correo)) {
    console.error(`"${v.nombre}" no tiene un correo válido (${v.correo || 'vacío'}).`); process.exit(1)
  }

  console.log(`Enviando bienvenida a: ${v.nombre} · ${v.nombre_contacto} · ${v.correo}`)
  await enviarBienvenidaConvenioVet({
    email: v.correo,
    vetNombre: v.nombre,
    contacto: v.nombre_contacto, cargoContacto: v.cargo_contacto,
    razonSocial: v.razon_social, rut: v.rut, giro: v.giro,
    direccion: v.direccion, comuna: v.comuna, telefono: v.telefono,
  })
  console.log('Listo.')
}

main().catch(e => { console.error('ERROR:', e instanceof Error ? e.message : e); process.exit(1) })
