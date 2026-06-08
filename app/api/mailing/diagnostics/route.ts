import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { isResendConfigured } from '@/lib/resend-mailer'
import { isSupabaseConfigured } from '@/lib/supabase'
import { esAdmin } from '@/lib/roles'

/**
 * GET /api/mailing/diagnostics
 * Devuelve el estado de configuración del módulo de mailing para mostrar
 * un banner de salud en la UI. Si tracking_ok es false, los pixels y clicks
 * de los envíos NO se registran.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!esAdmin((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }

  const baseUrl = (process.env.PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '').replace(/\/+$/, '')
  const isLocalhost = /localhost|127\.0\.0\.1/i.test(baseUrl)
  const baseMissing = !baseUrl
  const isDev = process.env.NODE_ENV !== 'production' || isLocalhost
  const fromEmail = process.env.MAILING_FROM_EMAIL || 'onboarding@resend.dev'
  const fromName = process.env.MAILING_FROM_NAME || 'Alma Animal'
  const webhookSecret = !!process.env.RESEND_WEBHOOK_SECRET
  const ownTrackingDisabled = (process.env.MAILING_DISABLE_OWN_TRACKING ?? '').toLowerCase() === 'true'

  // Si el tracking propio está apagado, asumimos que Resend lo maneja con su
  // tracking subdomain. tracking_ok se considera OK porque los envíos van a
  // contar aperturas/clicks por la vía de Resend (no por la nuestra).
  const trackingOk = ownTrackingDisabled || (!baseMissing && !isLocalhost)

  return NextResponse.json({
    resend_ok: isResendConfigured(),
    supabase_ok: isSupabaseConfigured(),
    tracking_ok: trackingOk,
    own_tracking_disabled: ownTrackingDisabled,
    base_url: baseUrl || null,
    is_dev: isDev,
    base_missing: baseMissing,
    base_localhost: isLocalhost,
    from_email: fromEmail,
    from_name: fromName,
    sandbox_from: fromEmail.endsWith('@resend.dev'),
    webhook_secret: webhookSecret,
  })
}
