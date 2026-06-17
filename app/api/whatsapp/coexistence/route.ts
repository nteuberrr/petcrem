import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdmin } from '@/lib/roles'

export const dynamic = 'force-dynamic'

const GRAPH = 'https://graph.facebook.com'
const VERSION = process.env.WHATSAPP_API_VERSION || 'v22.0'

/**
 * Cierre del Embedded Signup de Coexistence. La página /wa-coexistence lanza el
 * flujo de Meta (QR que se escanea en la WhatsApp Business app) y nos manda el
 * `code` + `waba_id` + `phone_number_id`. Acá:
 *   1. (best-effort) cambiamos el code por un token de negocio (valida el code).
 *   2. Suscribimos NUESTRA app a la WABA (subscribed_apps) para recibir webhooks.
 * Devolvemos los ids para que, si el phone_number_id cambió, se actualice
 * WHATSAPP_PHONE_NUMBER_ID en Vercel. Solo admin.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!esAdmin((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }

  let body: { code?: string; waba_id?: string; phone_number_id?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'body inválido' }, { status: 400 }) }
  const { code, waba_id, phone_number_id } = body
  if (!waba_id) return NextResponse.json({ error: 'Falta waba_id (no llegó la info de sesión del Embedded Signup).' }, { status: 400 })

  const appId = process.env.NEXT_PUBLIC_FB_APP_ID || process.env.FB_APP_ID
  const appSecret = process.env.META_APP_SECRET
  const sysToken = process.env.WHATSAPP_TOKEN

  const out: Record<string, unknown> = { waba_id, phone_number_id }

  // 1) Intercambio del code (best-effort: valida el code y, si sirve, da un token de negocio).
  let businessToken = ''
  if (code && appId && appSecret) {
    try {
      const u = new URL(`${GRAPH}/${VERSION}/oauth/access_token`)
      u.searchParams.set('client_id', appId)
      u.searchParams.set('client_secret', appSecret)
      u.searchParams.set('code', code)
      const r = await fetch(u, { method: 'GET' })
      const j = await r.json().catch(() => ({}))
      if (r.ok && j?.access_token) businessToken = j.access_token
      else out.exchange_warning = j?.error?.message || `HTTP ${r.status}`
    } catch (e) { out.exchange_warning = e instanceof Error ? e.message : String(e) }
  }

  // 2) Suscribir la app a la WABA (idempotente). Preferimos el token de negocio
  //    recién obtenido; si no, el System User token permanente.
  const token = businessToken || sysToken
  if (!token) return NextResponse.json({ error: 'No hay token para suscribir la app (ni del intercambio ni WHATSAPP_TOKEN).', ...out }, { status: 500 })
  try {
    const r = await fetch(`${GRAPH}/${VERSION}/${waba_id}/subscribed_apps`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    })
    const j = await r.json().catch(() => ({}))
    out.subscribed = !!j?.success || r.ok
    if (!r.ok) out.subscribe_error = j?.error?.message || `HTTP ${r.status}`
  } catch (e) {
    out.subscribe_error = e instanceof Error ? e.message : String(e)
  }

  return NextResponse.json({ ok: true, ...out })
}
