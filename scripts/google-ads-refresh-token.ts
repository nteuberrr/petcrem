import './_env-preload'
import http from 'node:http'

/**
 * Genera el refresh_token de OAuth para la Google Ads API (flujo "installed app"
 * / loopback, RFC 8252). Correr UNA vez (o de nuevo si el refresh_token deja de
 * servir, ej. por quedar la app en modo "Prueba" sin verificar):
 *
 *   npx tsx scripts/google-ads-refresh-token.ts
 *
 * Abre la URL que imprime, autorizá con la cuenta de Google Ads, y el script
 * captura el código, lo cambia por tokens y muestra el refresh_token para
 * pegar en .env.local (GOOGLE_ADS_REFRESH_TOKEN).
 */

const PORT = 8085
const REDIRECT_URI = `http://localhost:${PORT}`
const SCOPE = 'https://www.googleapis.com/auth/adwords'

async function main() {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('Faltan GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET en .env.local')
  }

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', SCOPE)
  authUrl.searchParams.set('access_type', 'offline')
  authUrl.searchParams.set('prompt', 'consent')

  console.log('\n1) Abrí esta URL en tu navegador (con la cuenta de Google que administra Google Ads):\n')
  console.log(authUrl.toString())
  console.log('\n2) Autorizá el acceso. El navegador va a redirigir a localhost — esta ventana lo captura sola.\n')
  console.log(`Esperando en ${REDIRECT_URI} ...\n`)

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url || '/', REDIRECT_URI)
      const c = u.searchParams.get('code')
      const err = u.searchParams.get('error')
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      if (err) {
        res.end(`<h2>Error: ${err}</h2><p>Podés cerrar esta pestaña.</p>`)
        server.close()
        reject(new Error(`Google devolvió error: ${err}`))
        return
      }
      if (!c) { res.end('Esperando código…'); return }
      res.end('<h2>¡Listo!</h2><p>Ya podés cerrar esta pestaña y volver a la terminal.</p>')
      server.close()
      resolve(c)
    })
    server.listen(PORT)
  })

  console.log('Código recibido, cambiando por tokens…\n')

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })
  const tokenJson = await tokenRes.json().catch(() => ({})) as Record<string, unknown>
  if (!tokenRes.ok) {
    console.error('ERROR al canjear el código:', JSON.stringify(tokenJson, null, 2))
    process.exit(1)
  }
  if (!tokenJson.refresh_token) {
    console.error('La respuesta no trajo refresh_token. Esto pasa si ya habías autorizado antes sin `prompt=consent` — reintentá (este script ya lo fuerza) o revocá el acceso previo en https://myaccount.google.com/permissions y volvé a correr.')
    console.error(JSON.stringify(tokenJson, null, 2))
    process.exit(1)
  }

  console.log('=== REFRESH TOKEN (guardalo en .env.local como GOOGLE_ADS_REFRESH_TOKEN) ===\n')
  console.log(tokenJson.refresh_token)
  console.log('')
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL:', e.message || e); process.exit(1) })
