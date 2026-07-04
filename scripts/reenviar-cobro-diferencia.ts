import './_env-preload'
import { getSheetData, updateById } from '../lib/datastore'
import { calcularSnapshotFicha } from '../lib/price-calculator'
import { parsePeso } from '../lib/numbers'
import { buildCobroDiferencia } from '../lib/cliente-mailer'
import { sendEmail } from '../lib/resend-mailer'
import { getContacto } from '../lib/email-layout'
import { registrarEnvio } from '../lib/correos-log'

// REENVÍA el correo de cobro por diferencia de peso (misma lógica que
// /api/clientes/[id]/cobro-diferencia pero SIN el guard de idempotencia — para
// cuando el primer envío salió incompleto, p. ej. sin los datos bancarios):
//   npx tsx scripts/reenviar-cobro-diferencia.ts <clienteId> [<clienteId> ...]
async function main() {
  const ids = process.argv.slice(2).filter(a => /^\d+$/.test(a))
  if (ids.length === 0) { console.error('Uso: npx tsx scripts/reenviar-cobro-diferencia.ts <clienteId> ...'); process.exit(1) }

  const clientes = await getSheetData('clientes')
  const cfgRows = await getSheetData('empresa_config')
  const cfg = cfgRows.find(r => r.id === '1') || cfgRows[0] || {}
  const contacto = await getContacto()

  for (const id of ids) {
    const c = clientes.find(r => r.id === id)
    if (!c) { console.error(`#${id}: cliente no encontrado`); continue }
    const email = (c.email || '').trim()
    let fotos: string[] = []
    try { const x = JSON.parse(c.fotos_evidencia || '[]'); if (Array.isArray(x)) fotos = x } catch { /* */ }
    const pesoDeclarado = parsePeso(c.peso_declarado)
    const pesoIngreso = parsePeso(c.peso_ingreso)
    if (!email || fotos.length === 0 || !(pesoDeclarado > 0) || !(pesoIngreso > 0)) {
      console.error(`#${id} (${c.nombre_mascota}): faltan email/foto/pesos — no se reenvía`); continue
    }
    const base = { codigo_servicio: c.codigo_servicio || 'CI', veterinaria_id: c.veterinaria_id || undefined, tipo_precios: c.tipo_precios || undefined, adicionales: [] }
    const monto = (await calcularSnapshotFicha({ ...base, peso: pesoIngreso })).precio_servicio - (await calcularSnapshotFicha({ ...base, peso: pesoDeclarado })).precio_servicio
    if (monto <= 0) { console.error(`#${id} (${c.nombre_mascota}): sin diferencia que cobrar`); continue }

    const opts = buildCobroDiferencia({
      email, nombreMascota: c.nombre_mascota || 'tu mascota', nombreTutor: c.nombre_tutor || '',
      clienteId: id, pesoDeclarado, pesoIngreso, monto,
      transferencia: {
        titular: cfg.nombre || '', rut: cfg.rut || '', banco: cfg.banco || '',
        tipoCuenta: cfg.tipo_cuenta || '', numeroCuenta: cfg.numero_cuenta || '', correo: cfg.correo || '',
      },
    }, contacto)
    const fotoUrl = fotos[fotos.length - 1]
    const ext = (() => { const e = (fotoUrl.split('.').pop() || '').toLowerCase(); return ['jpg', 'jpeg', 'png', 'webp'].includes(e) ? e : 'jpg' })()
    const res = await sendEmail({
      ...opts,
      attachments: [{
        filename: `Evidencia_peso_${(c.nombre_mascota || 'mascota').replace(/[^\w\-]/g, '_')}.${ext}`,
        path: fotoUrl,
        content_type: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg',
      }],
    })
    await registrarEnvio({ clienteId: id, tipo: 'cobro_diferencia', email, messageId: res.message_id, ok: res.ok, error: res.error })
    if (!res.ok) { console.error(`#${id} (${c.nombre_mascota}): FALLÓ el envío: ${res.error}`); continue }
    await updateById('clientes', id, { ...c, correo_diferencia_fecha: new Date().toISOString(), correo_diferencia_monto: String(monto) })
    console.log(`OK #${id} ${c.nombre_mascota} → ${email} (monto $${monto.toLocaleString('es-CL')}, message_id ${res.message_id})`)
  }
}

main()
