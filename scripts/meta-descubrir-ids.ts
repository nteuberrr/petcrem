import './_env-preload'

/**
 * Descubre los IDs de Meta que faltan en .env.local para publicar en Campañas
 * (Facebook + Instagram). Lee META_GRAPH_TOKEN (o WHATSAPP_TOKEN como respaldo) y
 * consulta la Graph API para imprimir:
 *   - META_PAGE_ID      → ID de cada Página de Facebook que administra el token.
 *   - META_IG_USER_ID   → ID de la cuenta de Instagram Business vinculada.
 *   - Los scopes que tiene el token (para verificar que alcanza para publicar).
 *
 * Uso:  npx tsx scripts/meta-descubrir-ids.ts
 *
 * Es de SOLO LECTURA: no publica ni modifica nada.
 */

const API = process.env.META_API_VERSION || process.env.WHATSAPP_API_VERSION || 'v22.0'
const TOKEN = process.env.META_GRAPH_TOKEN || process.env.WHATSAPP_TOKEN || ''
const BASE = `https://graph.facebook.com/${API}`

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = (data as { error?: { message?: string } })?.error?.message || `HTTP ${res.status}`
    throw new Error(err)
  }
  return data
}

async function main() {
  if (!TOKEN) {
    console.error('\n❌ No hay token. Pega META_GRAPH_TOKEN (o WHATSAPP_TOKEN) en .env.local y vuelve a correr.\n')
    process.exit(1)
  }
  console.log(`\n🔎 Consultando la Graph API (${API})…\n`)

  // 1) Scopes del token (para verificar que alcanza para publicar).
  try {
    const dbg = await getJson(`${BASE}/debug_token?input_token=${encodeURIComponent(TOKEN)}&access_token=${encodeURIComponent(TOKEN)}`)
    const scopes = (dbg as { data?: { scopes?: string[]; expires_at?: number } })?.data?.scopes || []
    const exp = (dbg as { data?: { expires_at?: number } })?.data?.expires_at
    console.log('🔐 Scopes del token:', scopes.length ? scopes.join(', ') : '(no se pudieron leer)')
    const faltan = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish']
      .filter(s => !scopes.includes(s))
    if (scopes.length && faltan.length) {
      console.log('⚠️  Faltan scopes para publicar:', faltan.join(', '))
      console.log('    → Regenera el System User token incluyéndolos (ver la guía).')
    } else if (scopes.length) {
      console.log('✅ El token tiene los scopes necesarios para publicar.')
    }
    console.log('⏳ Expira:', exp ? (exp === 0 ? 'nunca (System User)' : new Date(exp * 1000).toISOString()) : 'desconocido')
    console.log('')
  } catch (e) {
    console.log('ℹ️  No se pudo leer los scopes del token (no es bloqueante):', e instanceof Error ? e.message : String(e), '\n')
  }

  // 2) Páginas que administra el token + su Instagram Business vinculado.
  try {
    const acc = await getJson(`${BASE}/me/accounts?fields=id,name,instagram_business_account{id,username,name}&access_token=${encodeURIComponent(TOKEN)}`)
    const pages = (acc as { data?: Array<{ id: string; name: string; instagram_business_account?: { id: string; username?: string; name?: string } }> })?.data || []
    if (pages.length === 0) {
      console.log('❌ El token no administra ninguna Página de Facebook.')
      console.log('   Revisa que: (a) el System User tenga asignada la Página en Business Settings,')
      console.log('   y (b) el token incluya el scope pages_show_list. Luego vuelve a correr.\n')
      return
    }
    console.log(`📄 Páginas encontradas (${pages.length}):\n`)
    for (const p of pages) {
      console.log(`  • ${p.name}`)
      console.log(`      META_PAGE_ID=${p.id}`)
      if (p.instagram_business_account?.id) {
        const ig = p.instagram_business_account
        console.log(`      META_IG_USER_ID=${ig.id}   (IG @${ig.username || ig.name || '—'})`)
      } else {
        console.log('      META_IG_USER_ID=  ⚠️  esta Página no tiene una cuenta de Instagram Business vinculada.')
        console.log('         → Vincúlala en la app de Instagram (Configuración → Cuenta → Compartir en otras apps → Facebook)')
        console.log('           o desde Business Settings → Cuentas de Instagram, y vuelve a correr.')
      }
      console.log('')
    }
    console.log('👉 Copia META_PAGE_ID y META_IG_USER_ID de la Página correcta a tu .env.local.\n')
  } catch (e) {
    console.error('❌ Error consultando las Páginas:', e instanceof Error ? e.message : String(e), '\n')
    process.exit(1)
  }
}

main()
