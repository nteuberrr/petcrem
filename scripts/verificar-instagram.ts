import './_env-preload'
import { getMensajesSupabase } from '../lib/supabase'

/**
 * Chequeo de salud del canal INSTAGRAM del inbox (DMs + agente).
 *   npx tsx scripts/verificar-instagram.ts
 *
 * Existe por el punto ciego del 12-08-2026: los DMs dejaron de llegar y nadie se
 * enteró, porque cuando Meta NO entrega un webhook no hay error en ninguna parte
 * — simplemente no pasa nada. La causa fue que la app sigue con acceso ESTÁNDAR
 * (sin App Review de instagram_manage_messages): en ese modo Meta solo entrega
 * los DMs de cuentas CON ROL en la app (admins/testers), y todo lo del público
 * —incluidas las solicitudes de mensaje— se descarta en silencio.
 *
 * La señal más clara del problema es la #6: si /conversations le muestra a la app
 * muchas menos conversaciones de las que se ven en el teléfono, es acceso estándar.
 * Read-only: no envía ni acusa nada.
 */

const V = process.env.WHATSAPP_API_VERSION || 'v22.0'
const G = `https://graph.facebook.com/${V}`

const ok = (s: string) => console.log(`  ✅ ${s}`)
const mal = (s: string) => console.log(`  ❌ ${s}`)
const ojo = (s: string) => console.log(`  ⚠️  ${s}`)

const problemas: string[] = []

async function get<T = Record<string, unknown>>(url: string): Promise<{ status: number; j: T }> {
  const res = await fetch(url)
  const j = (await res.json().catch(() => ({}))) as T
  return { status: res.status, j }
}

async function main() {
  const appId = process.env.NEXT_PUBLIC_FB_APP_ID || ''
  const secret = process.env.META_APP_SECRET || ''
  const wt = process.env.WHATSAPP_TOKEN || ''
  const page = process.env.META_PAGE_ID || ''

  console.log('\n════ 1. Variables de entorno ════')
  for (const [k, v] of [['NEXT_PUBLIC_FB_APP_ID', appId], ['META_APP_SECRET', secret], ['WHATSAPP_TOKEN', wt], ['META_PAGE_ID', page]] as const) {
    if (v) ok(`${k} presente`)
    else { mal(`${k} FALTA`); problemas.push(`falta ${k}`) }
  }
  if (!appId || !secret || !wt || !page) { console.log('\nSin estas variables no se puede seguir.'); process.exit(1) }

  // ── 2. La APP suscrita al objeto `instagram` ───────────────────────────────
  console.log('\n════ 2. Suscripción de la app al objeto `instagram` ════')
  type Sub = { object?: string; callback_url?: string; active?: boolean; fields?: Array<{ name?: string }> }
  const subs = await get<{ data?: Sub[] }>(`${G}/${appId}/subscriptions?access_token=${encodeURIComponent(`${appId}|${secret}`)}`)
  const ig = (subs.j.data || []).find(s => s.object === 'instagram')
  if (!ig) { mal('la app NO está suscrita al objeto `instagram`'); problemas.push('app sin suscripción al objeto instagram') }
  else {
    const campos = (ig.fields || []).map(f => f.name)
    ok(`suscrita → ${ig.callback_url} (activa: ${ig.active}) campos: ${campos.join(', ') || '—'}`)
    if (!campos.includes('messages')) { mal('falta el campo `messages`'); problemas.push('objeto instagram sin campo messages') }
    if (ig.active === false) { mal('la suscripción está INACTIVA (Meta la deshabilitó por fallas)'); problemas.push('suscripción instagram inactiva') }
  }

  // ── 3. Page token + suscripción de la PÁGINA ───────────────────────────────
  console.log('\n════ 3. Página de Facebook (la que enruta los DMs) ════')
  const pt = await get<{ access_token?: string }>(`${G}/${page}?fields=access_token&access_token=${encodeURIComponent(wt)}`)
  const pageToken = pt.j.access_token || ''
  if (!pageToken) {
    mal('no se pudo derivar el page token desde WHATSAPP_TOKEN (lo usa lib/instagram para ENVIAR)')
    problemas.push('sin page token')
  } else ok('page token derivado de WHATSAPP_TOKEN')

  if (pageToken) {
    const sa = await get<{ data?: Array<{ name?: string; id?: string; subscribed_fields?: string[] }> }>(
      `${G}/${page}/subscribed_apps?access_token=${encodeURIComponent(pageToken)}`)
    const apps = sa.j.data || []
    const mia = apps.find(a => a.id === appId)
    if (!mia) { mal(`la página NO tiene suscrita la app ${appId} (POST /${page}/subscribed_apps)`); problemas.push('página sin subscribed_apps') }
    else ok(`página suscrita a "${mia.name}" → campos: ${(mia.subscribed_fields || []).join(', ')}`)

    const info = await get<{ name?: string; instagram_business_account?: { id?: string; username?: string } }>(
      `${G}/${page}?fields=name,instagram_business_account{id,username}&access_token=${encodeURIComponent(pageToken)}`)
    const cuenta = info.j.instagram_business_account
    if (!cuenta?.id) { mal('la página no tiene una cuenta de Instagram profesional vinculada'); problemas.push('IG no vinculado a la página') }
    else ok(`página "${info.j.name}" ↔ IG @${cuenta.username} (${cuenta.id})`)
  }

  // ── 4. Scopes del token ────────────────────────────────────────────────────
  console.log('\n════ 4. Permisos del token ════')
  const dbg = await get<{ data?: { scopes?: string[]; is_valid?: boolean; app_id?: string } }>(
    `${G}/debug_token?input_token=${encodeURIComponent(wt)}&access_token=${encodeURIComponent(wt)}`)
  const scopes = dbg.j.data?.scopes || []
  if (!dbg.j.data?.is_valid) { mal('WHATSAPP_TOKEN inválido'); problemas.push('token inválido') }
  for (const p of ['instagram_basic', 'instagram_manage_messages', 'pages_messaging', 'pages_manage_metadata']) {
    if (scopes.includes(p)) ok(`${p}`)
    else { mal(`falta el permiso ${p}`); problemas.push(`token sin ${p}`) }
  }
  if (dbg.j.data?.app_id !== appId) {
    ojo(`el token es de la app ${dbg.j.data?.app_id} y el webhook de ${appId} — el ENVÍO puede fallar con (#200)`)
  }

  // ── 5. Estado en nuestra base ──────────────────────────────────────────────
  console.log('\n════ 5. Qué llegó al inbox ════')
  const sb = getMensajesSupabase()
  const { data: convs } = await sb.from('mensajes_conversaciones')
    .select('id, ultimo_mensaje_at').eq('canal', 'instagram')
    .order('ultimo_mensaje_at', { ascending: false })
  const nConv = convs?.length ?? 0
  const ultimo = convs?.[0]?.ultimo_mensaje_at
  const dias = ultimo ? Math.floor((Date.now() - new Date(ultimo).getTime()) / 86_400_000) : null
  console.log(`  conversaciones IG en la base: ${nConv}`)
  if (!ultimo) { mal('nunca llegó un DM al sistema'); problemas.push('cero DMs recibidos') }
  else if (dias !== null && dias > 3) {
    mal(`el último movimiento fue hace ${dias} días (${ultimo}) — con DMs reales entrando, esto significa que Meta NO los está entregando`)
    problemas.push(`${dias} días sin recibir DMs`)
  } else ok(`último movimiento hace ${dias} día(s)`)

  const { data: fallidos } = await sb.from('mensajes_mensajes')
    .select('id, conversacion_id, ts, cuerpo').eq('estado', 'fallido').eq('direccion', 'saliente')
    .in('conversacion_id', (convs ?? []).map(c => c.id)).order('ts', { ascending: false }).limit(5)
  if (fallidos?.length) {
    ojo(`${fallidos.length} respuesta(s) saliente(s) marcadas como fallidas — la más nueva: ${fallidos[0].ts}`)
  }

  // ── 6. ¿ACCESO AVANZADO? (la prueba que importa) ───────────────────────────
  console.log('\n════ 6. Acceso avanzado (App Review) — la prueba decisiva ════')
  if (pageToken) {
    const conv = await get<{ data?: Array<{ id?: string; updated_time?: string }>; error?: { message?: string; code?: number } }>(
      `${G}/${page}/conversations?platform=instagram&fields=id,updated_time&limit=50&access_token=${encodeURIComponent(pageToken)}`)
    if (conv.j.error) {
      mal(`Meta no deja listar conversaciones: ${conv.j.error.message}`)
      problemas.push('sin acceso a /conversations')
    } else {
      const n = conv.j.data?.length ?? 0
      console.log(`  conversaciones de IG que Meta le muestra a la app: ${n}`)
      console.log(`  → Comparalo con lo que ves en el teléfono (bandeja + SOLICITUDES).`)
      if (n <= 1) {
        mal('la app ve 1 conversación o ninguna: es el patrón de ACCESO ESTÁNDAR — Meta solo entrega los DMs de cuentas con rol en la app y descarta los del público')
        problemas.push('acceso estándar: falta App Review de instagram_manage_messages')
      } else {
        ok(`la app ve ${n} conversaciones`)
      }
    }
  }

  // ── Veredicto ──────────────────────────────────────────────────────────────
  console.log('\n════ Veredicto ════')
  if (!problemas.length) {
    console.log('  ✅ Todo en orden: la app puede recibir y responder DMs de cualquiera.\n')
    return
  }
  for (const p of problemas) console.log(`  • ${p}`)
  if (problemas.some(p => p.includes('App Review') || p.includes('sin recibir'))) {
    console.log(`
  El bot está bien: la plomería (webhook, suscripciones, token, permisos) está
  completa y el código responde. Lo que falta es el PERMISO de Meta.

  Mientras la app tenga acceso ESTÁNDAR, Meta solo entrega los DMs de cuentas con
  rol en la app. Los del público —y las SOLICITUDES de mensaje— no llegan nunca y
  no dejan rastro. Se destraba con App Review de instagram_manage_messages
  (developers.facebook.com → la app → Revisión de la app → Permisos y funciones).
  Aprobado eso, las solicitudes entran solas: el webhook las entrega igual que
  cualquier DM y, al responder el bot, la conversación sale de Solicitudes.
  Ojo: una solicitud sin actividad por más de 30 días ya no vuelve por la API.
`)
  }
  process.exitCode = 1
}

main().catch(e => { console.error(e); process.exit(1) })
