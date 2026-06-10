/**
 * Envía a un correo de revisión TODOS los correos transaccionales del catálogo
 * (lib/correos-catalogo) — tutores + veterinarios — usando como ejemplo los datos
 * del ÚLTIMO cliente real (mayor id, con código, no borrador). Lee de la base
 * ACTUAL vía datastore (respeta DATA_BACKEND=postgres).
 *
 *   npx tsx scripts/enviar-correos-revision.ts [correo_destino]
 *
 * Default: cristobal.avr@gmail.com
 */
import './_env-preload'
import { getSheetData } from '../lib/datastore'
import { sendEmail } from '../lib/resend-mailer'
import { getContacto } from '../lib/email-layout'
import { CORREOS, type MuestraCorreo } from '../lib/correos-catalogo'
import { formatDate, todayISO } from '../lib/dates'

const DESTINO = process.argv[2] || 'cristobal.avr@gmail.com'

async function main() {
  const [clientes, ciclos] = await Promise.all([
    getSheetData('clientes'),
    getSheetData('ciclos').catch(() => []),
  ])
  const contacto = await getContacto()

  // Último cliente REAL: mayor id, con código y nombre de mascota, no borrador.
  const real = clientes
    .filter(c => (c.codigo || '').trim() && (c.nombre_mascota || '').trim() && c.estado !== 'borrador')
    .sort((a, b) => (parseInt(b.id) || 0) - (parseInt(a.id) || 0))[0]
  if (!real) throw new Error('No encontré un cliente real para usar de ejemplo.')

  const ciclo = ciclos.find(c => c.id === real.ciclo_id)
  const fechaCremacion = formatDate(ciclo?.fecha || real.fecha_retiro || todayISO())

  const muestra: MuestraCorreo = {
    nombreMascota: real.nombre_mascota,
    nombreTutor: real.nombre_tutor,
    codigo: real.codigo,
    email: DESTINO, // todo va a revisión; no exponemos el correo real del cliente
    fechaCremacion,
  }

  console.log(`Ejemplo: ${real.nombre_mascota} — tutor ${real.nombre_tutor} — código ${real.codigo}`)
  console.log(`Enviando ${CORREOS.length} correos a ${DESTINO}…\n`)

  let i = 0
  for (const def of CORREOS) {
    i++
    const r = def.build(muestra, contacto)
    try {
      await sendEmail({
        to: DESTINO,
        subject: `[Revisión ${i}/${CORREOS.length} · ${def.audiencia}] ${r.subject}`,
        html: r.html,
        preview_text: `${def.modulo} — ${def.titulo}`,
      })
      console.log(`  ✓ ${i}. [${def.modulo}/${def.audiencia}] ${def.titulo}`)
    } catch (e) {
      console.log(`  ✗ ${i}. ${def.titulo} — ${e instanceof Error ? e.message : e}`)
    }
  }

  console.log(`\nListo. Revisa la bandeja de ${DESTINO}.`)
}

main().catch(e => { console.error('ERROR:', e instanceof Error ? e.message : e); process.exit(1) })
