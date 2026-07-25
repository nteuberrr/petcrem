/**
 * Marca una acción de conversión de Google Ads como PRIMARIA o SECUNDARIA.
 *
 *   npx tsx scripts/gads-conversion-primaria.ts --id=7394793982 --primaria=true
 *   ... agregando --aplicar para escribir de verdad (sin el flag solo valida).
 *
 * Solo las PRIMARIAS entran en la columna «Conversiones» y alimentan el Smart
 * Bidding; las secundarias quedan como observación. Hoy en la cuenta:
 *   PRIMARIAS   → Join Chat (7394793985) · Calls from ads (7431459832)
 *   SECUNDARIAS → Click Teléfono (7394793982) · Click Mail (7394793979)
 *                 Whatsapp Footer (7515000414) · Escríbenos ahora (7568381937)
 *                 Clicks to call (7435740414)
 *
 * `include_in_conversions_metric` es INMUTABLE por API (la deriva Google): lo que
 * se mutá es `primary_for_goal`, y el objetivo de la cuenta correspondiente
 * (categoría + origen) debe estar como «biddable» — CONTACT/WEBSITE ya lo está.
 *
 * Listado de acciones con su estado actual: scripts/google-ads-historico.ts o la
 * consulta GAQL `SELECT conversion_action.id, conversion_action.name,
 * conversion_action.primary_for_goal FROM conversion_action`.
 */
import './_env-preload'

const BASE = `https://googleads.googleapis.com/${process.env.GOOGLE_ADS_API_VERSION || 'v23'}`

function arg(nombre: string, def = ''): string {
  const m = process.argv.find(a => a.startsWith(`--${nombre}=`))
  return m ? m.split('=').slice(1).join('=') : def
}

async function token(): Promise<string> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET || '',
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN || '',
      grant_type: 'refresh_token',
    }),
  })
  const j = await r.json() as { access_token?: string; error_description?: string }
  if (!j.access_token) throw new Error(j.error_description || 'no se pudo renovar el token')
  return j.access_token
}

async function main() {
  const id = arg('id')
  const primaria = arg('primaria', 'true') !== 'false'
  const aplicar = process.argv.includes('--aplicar')
  if (!id) throw new Error('Falta --id=<conversion_action_id>')

  const t = await token()
  const cid = process.env.GOOGLE_ADS_CUSTOMER_ID || ''
  const res = await fetch(`${BASE}/customers/${cid}/conversionActions:mutate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${t}`,
      'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
      'login-customer-id': process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || cid,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operations: [{
        updateMask: 'primary_for_goal',
        update: { resourceName: `customers/${cid}/conversionActions/${id}`, primaryForGoal: primaria },
      }],
      validateOnly: !aplicar,
    }),
  })
  const j = await res.json() as { error?: { message?: string; details?: unknown } }
  if (!res.ok) {
    const det = (j.error?.details as Array<{ errors?: Array<{ message?: string }> }> | undefined)?.[0]?.errors?.[0]
    console.error('✖', det?.message || j.error?.message)
    process.exit(1)
  }
  console.log(aplicar
    ? `✔ acción ${id} → ${primaria ? 'PRIMARIA' : 'secundaria'} (aplicado)`
    : `✔ validación OK — nada escrito. Repetí con --aplicar para hacerlo efectivo.`)
}

main().catch(e => { console.error('ERROR:', e instanceof Error ? e.message : e); process.exit(1) })
