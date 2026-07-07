import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { regenerarImagenPieza, isPiezaConfigurada } from '@/lib/marketing-pieza'

/**
 * POST /api/mailing/calendario/[id]/nueva-imagen  (admin)
 * "Misma copy, imagen nueva": conserva el copy y regenera SOLO la imagen desde cero
 * (con plantilla, distinta a la actual). No toca el texto ni el estado.
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
    const r = await regenerarImagenPieza(id, creadoPor)
    return NextResponse.json(r)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[mailing/calendario nueva-imagen]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
