import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { isResendConfigured } from '@/lib/resend-mailer'
import { listarAvisos, getAvisoMeta, guardarAvisoConfig, enviarAviso } from '@/lib/avisos'

/**
 * Avisos automáticos: catálogo + configuración + vista previa + envío de prueba.
 * Solo admin total (vive en Configuración Avanzada → Avisos; ver APIS_AVANZADAS
 * en lib/roles). El disparo programado NO pasa por acá: es /api/cron/avisos.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function requireAdminTotal() {
  const session = await getServerSession(authOptions)
  if (!esAdminTotal((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo el administrador' }, { status: 403 })
  }
  return null
}

/** GET → lista de avisos con su config. Con ?key= → vista previa del correo. */
export async function GET(req: NextRequest) {
  const denied = await requireAdminTotal()
  if (denied) return denied
  try {
    const key = req.nextUrl.searchParams.get('key')
    if (key) {
      const meta = getAvisoMeta(key)
      if (!meta) return NextResponse.json({ error: 'Aviso no encontrado' }, { status: 404 })
      const correo = await meta.construir()
      return NextResponse.json({ subject: correo.subject, html: correo.html, resumen: correo.resumen, vacio: correo.vacio })
    }
    return NextResponse.json({ avisos: await listarAvisos(), resendConfigurado: isResendConfigured() })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 })
  }
}

const guardarSchema = z.object({
  clave: z.string().min(1),
  activo: z.boolean().optional(),
  destinatarios: z.array(z.string()).optional(),
  hora: z.string().regex(/^\d{1,2}:\d{2}$/, 'Hora inválida (HH:MM)').optional(),
  omitirVacio: z.boolean().optional(),
})

/** PUT → guarda la configuración de un aviso. */
export async function PUT(req: NextRequest) {
  const denied = await requireAdminTotal()
  if (denied) return denied
  try {
    const parsed = guardarSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Datos inválidos' }, { status: 400 })
    }
    const { clave, ...campos } = parsed.data
    if (!getAvisoMeta(clave)) return NextResponse.json({ error: 'Aviso no encontrado' }, { status: 404 })
    return NextResponse.json({ config: await guardarAvisoConfig(clave, campos) })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 })
  }
}

const enviarSchema = z.object({
  clave: z.string().min(1),
  /** Si viene, se manda solo a estas direcciones (prueba). Si no, a las configuradas. */
  to: z.array(z.string().email('Correo inválido')).optional(),
})

/** POST → envía el aviso ahora (prueba o envío manual a los destinatarios). */
export async function POST(req: NextRequest) {
  const denied = await requireAdminTotal()
  if (denied) return denied
  try {
    const parsed = enviarSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Datos inválidos' }, { status: 400 })
    }
    const r = await enviarAviso(parsed.data.clave, { to: parsed.data.to })
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 })
    return NextResponse.json(r)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 })
  }
}
