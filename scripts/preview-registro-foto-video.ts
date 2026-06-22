/**
 * Envía un correo de PRUEBA de "registro de mascota" (con los botones de foto +
 * video, links firmados válidos 24h) a un correo de prueba, usando una ficha REAL
 * de la base (para que los tokens resuelvan).
 *
 *   npx tsx scripts/preview-registro-foto-video.ts [correo_destino]
 *
 * Base de los links: PREVIEW_BASE (env) o https://petcrem.vercel.app — la app en
 * prod. (El apex crematorioalmaanimal.cl redirige al sitio de marketing.)
 * El envío de prueba NO se registra ni hace BCC (se omite `seguimiento`).
 */
import './_env-preload' // DEBE ir primero: carga env antes de evaluar las libs
import { getSheetData } from '../lib/datastore'
import { buildRegistro } from '../lib/cliente-mailer'
import { getContacto } from '../lib/email-layout'
import { sendEmail } from '../lib/resend-mailer'

const DESTINO = process.argv[2] || 'nicoteuber@gmail.com'

async function main() {
  // En local NEXTAUTH_URL=localhost; forzamos la URL pública de la app para que
  // los botones del correo apunten a prod. buildRegistro la lee al ejecutarse.
  process.env.PUBLIC_APP_URL = process.env.PREVIEW_BASE || 'https://petcrem.vercel.app'

  const clientes = await getSheetData('clientes')
  const cliente = [...clientes]
    .filter(c => c.nombre_mascota && c.codigo)
    .sort((a, b) => (parseInt(b.id) || 0) - (parseInt(a.id) || 0))[0]
  if (!cliente) throw new Error('No hay clientes con mascota + código en la base')
  console.log(`Ficha de prueba: "${cliente.nombre_mascota}" (código ${cliente.codigo}, id ${cliente.id})`)

  const contacto = await getContacto()
  const opts = buildRegistro({
    email: DESTINO,
    nombreMascota: cliente.nombre_mascota,
    nombreTutor: cliente.nombre_tutor,
    codigo: cliente.codigo,
    clienteId: cliente.id,
  }, contacto)

  // Envío de prueba: sin `seguimiento` (no registra en correos_log ni hace BCC).
  const res = await sendEmail({ ...opts, seguimiento: undefined })
  console.log(res.ok ? `OK · message_id=${res.message_id}` : `FALLÓ: ${res.error}`)
  console.log(`Enviado a ${DESTINO}. Botones → ${process.env.PUBLIC_APP_URL} (tokens válidos 24h).`)
}

main().catch(e => { console.error('ERROR:', e instanceof Error ? e.message : e); process.exit(1) })
