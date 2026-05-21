import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { isResendConfigured } from '@/lib/resend-mailer'
import { isSupabaseConfigured } from '@/lib/supabase'

/**
 * GET /api/mailing/diagnostics
 * Devuelve el estado de configuración del módulo de mailing para mostrar
 * un banner de salud en la UI. Si tracking_ok es false, los pixels y clicks
 * de los envíos NO se registran.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if ((session?.user as { role?: string })?.role !== 'admin') {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }

  const baseUrl = (process.env.PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '').replace(/\/+$/, '')
  const isLocalhost = /localhost|127\.0\.0\.1/i.test(baseUrl)
  const baseMissing = !baseUrl
  const isDev = process.env.NODE_ENV !== 'production' || isLocalhost
  const fromEmail = process.env.MAILING_FROM_EMAIL || 'onboarding@resend.dev'
  const fromName = process.env.MAILING_FROM_NAME || 'Alma Animal'
  const webhookSecret = !!process.env.RESEND_WEBHOOK_SECRET

  return NextResponse.json({
    resend_ok: isResendConfigured(),
    supabase_ok: isSupabaseConfigured(),
    tracking_ok: !baseMissing && !isLocalhost,
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
