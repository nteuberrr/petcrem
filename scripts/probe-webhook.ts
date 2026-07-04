import './_env-preload'
import { sendEmail } from '../lib/resend-mailer'
import { registrarEnvio } from '../lib/correos-log'
import { getSupabase } from '../lib/supabase'

// Sonda del webhook de Resend: envía al simulador delivered@resend.dev (genera
// un evento email.delivered garantizado), registra la fila en correos_cliente y
// espera a ver si el webhook la reconcilia a 'entregado'.
async function main() {
  const res = await sendEmail({
    to: 'delivered@resend.dev',
    subject: 'Probe webhook (ignorar)',
    html: '<p>probe</p>',
    tags: [{ name: 'tipo', value: 'cliente_registro' }],
  })
  if (!res.ok || !res.message_id) { console.error('Envío falló:', res.error); process.exit(1) }
  console.log('Enviado, message_id:', res.message_id)
  await registrarEnvio({ clienteId: '', tipo: 'registro', email: 'delivered@resend.dev', messageId: res.message_id, ok: true })
  for (let i = 1; i <= 6; i++) {
    await new Promise(r => setTimeout(r, 20_000))
    const { data } = await getSupabase().from('correos_cliente').select('estado, fecha_actualizacion').eq('message_id', res.message_id).limit(1)
    console.log(`t+${i * 20}s → estado: ${data?.[0]?.estado}`)
    if (data?.[0]?.estado && data[0].estado !== 'enviado') { console.log('✅ Webhook VIVO'); process.exit(0) }
  }
  console.log('❌ El evento delivered nunca se aplicó → el webhook NO está llegando/procesando.')
}

main()
