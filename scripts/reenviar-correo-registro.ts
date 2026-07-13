/**
 * Reenvía el correo de REGISTRO (bienvenida + código + links de foto/video) al
 * tutor de una ficha, regenerando los links firmados con la vigencia actual
 * (48 h desde el reenvío). Útil cuando al tutor se le vencieron los links.
 *
 *   npx tsx scripts/reenviar-correo-registro.ts <código o id de la ficha>
 *   ej: npx tsx scripts/reenviar-correo-registro.ts G106
 *
 * Lee la ficha del backend vigente (datastore → Postgres) y usa el mismo
 * render/sender del sistema (lib/cliente-mailer.ts), así el correo queda
 * registrado en correos_cliente y correos_log como cualquier envío normal.
 */
import './_env-preload' // DEBE ir primero: carga env antes de evaluar las libs

// Los links del correo deben apuntar a producción aunque el .env.local tenga
// NEXTAUTH_URL=localhost (buildRegistro lee PUBLIC_APP_URL primero).
process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://petcrem.vercel.app'

import { getSheetData } from '../lib/datastore'
import { enviarRegistroMascota } from '../lib/cliente-mailer'

async function main() {
  const q = (process.argv[2] || '').trim()
  if (!q) {
    console.error('Uso: npx tsx scripts/reenviar-correo-registro.ts <código o id de la ficha>')
    process.exit(1)
  }
  const clientes = await getSheetData('clientes')
  const norm = (s: string) => (s || '').trim().toUpperCase()
  const cliente = clientes.find(c => String(c.id) === q)
    || clientes.find(c => norm(c.codigo) === norm(q))
    || clientes.find(c => norm(c.codigo).startsWith(norm(q) + '-'))
  if (!cliente) {
    console.error(`No encontré ninguna ficha con código o id "${q}".`)
    process.exit(1)
  }
  if (!cliente.email) {
    console.error(`La ficha ${cliente.codigo || cliente.id} (${cliente.nombre_mascota}) no tiene email.`)
    process.exit(1)
  }
  console.log(`Reenviando registro a ${cliente.email} — ${cliente.nombre_mascota} (${cliente.codigo}), servicio ${cliente.codigo_servicio}...`)
  await enviarRegistroMascota({
    email: cliente.email,
    nombreMascota: cliente.nombre_mascota,
    nombreTutor: cliente.nombre_tutor,
    codigo: cliente.codigo,
    clienteId: String(cliente.id),
    codigoServicio: cliente.codigo_servicio || '',
  })
  console.log('Listo.')
}

main().catch(e => { console.error(e); process.exit(1) })
