import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { generarPieza, isPiezaConfigurada } from '@/lib/marketing-pieza'

/**
 * POST /api/mailing/calendario/[id]/generar  (admin)
 * Genera la pieza del ítem (copy + imagen social, o asunto + HTML email).
 * Paso de COSTO: solo se llama sobre ítems que el dueño decidió producir.
 */
export const maxDuration = 300

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!esAdminTotal((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  if (!isPiezaConfigurada()) {
    return NextResponse.json({ error: 'El generador no está configurado (falta ANTHROPIC_API_KEY).' }, { status: 400 })
  }
  const { id } = await params
  try {
    const creadoPor = session?.user?.name || session?.user?.email || ''
    const r = await generarPieza(id, creadoPor)
    return NextResponse.json(r)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[mailing/calendario generar]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
