import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { editarImagenPieza } from '@/lib/marketing-pieza'

/**
 * POST /api/mailing/calendario/[id]/editar-imagen  (admin)
 * Body: { instruccion, indice? } → regenera la imagen `indice` (1-based) de la pieza
 * (o todas si se omite) usando la actual como base (image-to-image).
 */
export const maxDuration = 300

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!esAdminTotal((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  const { id } = await params
  try {
    const body = await req.json() as { instruccion?: string; indice?: number }
    if (!body.instruccion?.trim()) return NextResponse.json({ error: 'Falta la instrucción.' }, { status: 400 })
    const creadoPor = session?.user?.name || session?.user?.email || ''
    const r = await editarImagenPieza(id, body.instruccion, body.indice, creadoPor)
    return NextResponse.json(r)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[mailing/calendario editar-imagen]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
