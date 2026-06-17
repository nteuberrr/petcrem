/**
 * Envía el correo REAL de "Bienvenida al convenio" a varias veterinarias por id
 * (a su propio correo). Útil tras una importación masiva.
 *
 *   npx tsx scripts/enviar-bienvenida-vets.ts <id> [id...]
 */
import './_env-preload' // DEBE ir primero: carga env antes de evaluar las libs
import { getSheetData } from '../lib/datastore'
import { enviarBienvenidaConvenioVet } from '../lib/vet-cremacion-mailer'

const ids = process.argv.slice(2).map(s => s.trim()).filter(Boolean)

async function main() {
  if (ids.length === 0) { console.error('Uso: npx tsx scripts/enviar-bienvenida-vets.ts <id> [id...]'); process.exit(1) }
  const vets = await getSheetData('veterinarios')
  let enviados = 0
  for (const id of ids) {
    const v = vets.find(x => String(x.id) === id)
    if (!v) { console.log(`  – id ${id}: no encontrado`); continue }
    if (!v.correo || !/\S+@\S+\.\S+/.test(v.correo)) { console.log(`  – ${v.nombre} (id ${id}): sin correo válido (${v.correo})`); continue }
    console.log(`Enviando a: ${v.nombre} · ${v.nombre_contacto} · ${v.correo}`)
    await enviarBienvenidaConvenioVet({
      email: v.correo, vetNombre: v.nombre, contacto: v.nombre_contacto, cargoContacto: v.cargo_contacto,
      razonSocial: v.razon_social, rut: v.rut, giro: v.giro, direccion: v.direccion, comuna: v.comuna, telefono: v.telefono,
    })
    enviados++
  }
  console.log(`\nListo: ${enviados} correo(s) enviado(s).`)
}

main().catch(e => { console.error('ERROR:', e instanceof Error ? e.message : e); process.exit(1) })
