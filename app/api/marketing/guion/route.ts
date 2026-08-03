import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdmin } from '@/lib/roles'
import { generarGuion, isGuionConfigurado } from '@/lib/marketing-guion'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

/** POST { tema, segundos?, audiencia? } — escribe el guion de la locución. */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!esAdmin((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  try {
    if (!isGuionConfigurado()) {
      return NextResponse.json({ error: 'Falta ANTHROPIC_API_KEY' }, { status: 500 })
    }
    const body = await req.json().catch(() => ({}))
    const tema = String(body.tema ?? '').trim()
    if (!tema) return NextResponse.json({ error: 'Falta el tema del video' }, { status: 400 })

    const out = await generarGuion({
      tema,
      segundos: Number(body.segundos) || undefined,
      audiencia: body.audiencia === 'veterinarios' ? 'veterinarios' : 'tutores',
    })
    return NextResponse.json(out)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
