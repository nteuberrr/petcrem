import './_env-preload'
import { getSheetData } from '../lib/datastore'
import { getContacto } from '../lib/email-layout'
import { buildCobroDiferencia } from '../lib/cliente-mailer'
import { sendEmail } from '../lib/resend-mailer'

// Prueba del correo de cobro por diferencia de peso con los datos de
// transferencia REALES de empresa_config (sin registrar en correos_log):
//   npx tsx scripts/test-cobro-diferencia.ts <email-destino>
async function main() {
  const to = process.argv[2]
  if (!to) { console.error('Uso: npx tsx scripts/test-cobro-diferencia.ts <email>'); process.exit(1) }
  const cfgRows = await getSheetData('empresa_config')
  const cfg = cfgRows.find(r => r.id === '1') || cfgRows[0] || {}
  const contacto = await getContacto()
  const opts = buildCobroDiferencia({
    email: to,
    nombreMascota: 'Josefa',
    nombreTutor: 'Nicolás',
    pesoDeclarado: 8,
    pesoIngreso: 12.4,
    monto: 15000,
    transferencia: {
      titular: cfg.nombre || '',
      rut: cfg.rut || '',
      banco: cfg.banco || '',
      tipoCuenta: cfg.tipo_cuenta || '',
      numeroCuenta: cfg.numero_cuenta || '',
      correo: cfg.correo || '',
    },
  }, contacto)
  console.log('Datos de transferencia en el correo:', { titular: cfg.nombre, rut: cfg.rut, banco: cfg.banco, tipo: cfg.tipo_cuenta, cuenta: cfg.numero_cuenta, correo: cfg.correo })
  const res = await sendEmail({ ...opts, subject: `[PRUEBA] ${opts.subject}`, seguimiento: undefined })
  console.log(res.ok ? `Enviado OK a ${to} (message_id ${res.message_id})` : `FALLÓ: ${res.error}`)
  process.exit(res.ok ? 0 : 1)
}

main()
