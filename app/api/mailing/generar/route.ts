import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdmin } from '@/lib/roles'
import { generarCampana, isGeneradorConfigurado, type CampanaActual } from '@/lib/mailing-generator'

// La generación puede incluir varias imágenes con Nano Banana Pro (lentas).
// Damos margen amplio al runtime (Vercel lo acota según el plan).
export const maxDuration = 300

/**
 * POST /api/mailing/generar  (admin-only)
 *
 * Genera o ajusta una campaña de email con IA (Claude dirige + Nano Banana Pro
 * genera/recicla imágenes desde el banco). Devuelve { asunto, preview_text, html,
 * imagenes, avisos } — el `html` ya trae las URLs reales de las imágenes.
 *
 * Body: { instruccion, categoria?, tono?, formato?, actual?, comentario?, variar? }
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!esAdmin((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  if (!isGeneradorConfigurado()) {
    return NextResponse.json({ error: 'El generador de IA no está configurado (falta ANTHROPIC_API_KEY).' }, { status: 400 })
  }

  try {
    const body = (await req.json()) as {
      instruccion?: string
      categoria?: string
      tono?: string
      formato?: string
      actual?: CampanaActual
      comentario?: string
      variar?: boolean
    }
    if (!body.instruccion || !body.instruccion.trim()) {
      return NextResponse.json({ error: 'Describe de qué se trata la campaña.' }, { status: 400 })
    }

    const creadoPor = session?.user?.name || session?.user?.email || ''
    const campana = await generarCampana({
      instruccion: body.instruccion,
      categoria: (body.categoria || 'todos').trim(),
      tono: body.tono,
      formato: body.formato,
      actual: body.actual,
      comentario: body.comentario,
      variar: !!body.variar,
      creadoPor,
    })
    return NextResponse.json(campana)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[mailing/generar]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
