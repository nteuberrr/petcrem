/**
 * Envía una PRUEBA del correo de "Bienvenida al convenio" (veterinarias) a un
 * correo de prueba. Usa la última veterinaria real como muestra de datos; si no
 * hay, usa datos de ejemplo. El correo se manda al destino de prueba, pero la
 * tabla de datos muestra el correo real de la veterinaria.
 *
 *   npx tsx scripts/preview-bienvenida-vet.ts [correo_destino]
 *
 * Si no se pasa correo, usa nicoteuber@gmail.com.
 */
import './_env-preload' // DEBE ir primero: carga env antes de evaluar las libs
import { getSheetData } from '../lib/datastore'
import { enviarBienvenidaConvenioVet } from '../lib/vet-cremacion-mailer'

const DESTINO = process.argv[2] || 'nicoteuber@gmail.com'

async function main() {
  const vets = await getSheetData('veterinarios').catch(() => [] as Record<string, string>[])
  const v = [...vets].sort((a, b) => (parseInt(b.id) || 0) - (parseInt(a.id) || 0))[0]

  const args = v
    ? {
        email: DESTINO, // se envía a tu correo para la prueba
        correoMostrar: v.correo || DESTINO, // pero la tabla muestra el correo real de la vet
        vetNombre: v.nombre || 'Veterinaria de ejemplo',
        contacto: v.nombre_contacto, cargoContacto: v.cargo_contacto,
        razonSocial: v.razon_social, rut: v.rut, giro: v.giro,
        direccion: v.direccion, comuna: v.comuna, telefono: v.telefono,
      }
    : {
        email: DESTINO,
        correoMostrar: 'contacto@veterinariasanfrancisco.cl',
        vetNombre: 'Veterinaria San Francisco', contacto: 'Camila Rojas', cargoContacto: 'Administradora',
        razonSocial: 'Clínica Veterinaria San Francisco SpA', rut: '76.123.456-7', giro: 'Servicios veterinarios',
        direccion: 'Av. Siempre Viva 742', comuna: 'Providencia', telefono: '912345678',
      }

  await enviarBienvenidaConvenioVet(args)
  console.log(`Bienvenida al convenio enviada a ${DESTINO} (muestra: ${args.vetNombre})`)
}

main().catch(e => { console.error('ERROR:', e instanceof Error ? e.message : e); process.exit(1) })
