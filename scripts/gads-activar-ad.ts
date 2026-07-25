/**
 * Activa (o pausa) anuncios por resource name.
 *
 *   npx tsx scripts/gads-activar-ad.ts --rn=customers/X/adGroupAds/A~B[,otro] [--estado=PAUSED] [--aplicar]
 *
 * Sin --aplicar solo valida contra la API (no escribe nada).
 *
 * Por qué existe: Google recomienda 2–3 RSA activos por grupo (más rotación =
 * mejor Ad Rank). En julio de 2026 los 11 grupos de la cuenta tenían UN solo
 * anuncio activo cada uno, con buenos anuncios creados y nunca encendidos.
 */
import './_env-preload'

const BASE = `https://googleads.googleapis.com/${process.env.GOOGLE_ADS_API_VERSION || 'v23'}`

function arg(n: string, def = ''): string {
  const m = process.argv.find(a => a.startsWith(`--${n}=`))
  return m ? m.split('=').slice(1).join('=') : def
}

async function token(): Promise<string> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID || '', client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET || '',
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN || '', grant_type: 'refresh_token',
    }),
  })
  const j = await r.json() as { access_token?: string; error_description?: string }
  if (!j.access_token) throw new Error(j.error_description || 'no se pudo renovar el token')
  return j.access_token
}

async function main() {
  const rns = arg('rn').split(',').map(s => s.trim()).filter(Boolean)
  const estado = arg('estado', 'ENABLED').toUpperCase()
  const aplicar = process.argv.includes('--aplicar')
  if (!rns.length) throw new Error('Falta --rn=<resourceName>[,<resourceName>…]')

  const t = await token()
  const cid = process.env.GOOGLE_ADS_CUSTOMER_ID || ''
  const res = await fetch(`${BASE}/customers/${cid}/adGroupAds:mutate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${t}`,
      'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
      'login-customer-id': process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || cid,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operations: rns.map(rn => ({ updateMask: 'status', update: { resourceName: rn, status: estado } })),
      validateOnly: !aplicar, partialFailure: false,
    }),
  })
  const j = await res.json() as { error?: { message?: string; details?: unknown } }
  if (!res.ok) {
    const det = (j.error?.details as Array<{ errors?: Array<{ message?: string }> }> | undefined)?.[0]?.errors?.[0]
    console.error('✖', det?.message || j.error?.message)
    process.exit(1)
  }
  console.log(aplicar ? `✔ ${rns.length} anuncio(s) → ${estado}` : `✔ validación OK (${rns.length} anuncios) — nada escrito`)
}

main().catch(e => { console.error('ERROR:', e instanceof Error ? e.message : e); process.exit(1) })
