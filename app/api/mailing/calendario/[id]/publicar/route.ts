import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { publicarItem } from '@/lib/marketing-publicar'

/**
 * POST /api/mailing/calendario/[id]/publicar  (admin)
 * Publica un ítem social (instagram | facebook) en la red vía Meta Graph API.
 * La lógica vive en lib/marketing-publicar (compartida con la herramienta del agente).
 */
export const maxDuration = 60

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!esAdminTotal((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  const { id } = await params
  try {
    const r = await publicarItem(id)
    return NextResponse.json(r)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[mailing/calendario publicar]', msg)
    const status = /no encontrada/i.test(msg) ? 404
      : /ya se está publicando|ya se publicó/i.test(msg) ? 409
      : /No se pudo publicar/i.test(msg) ? 502
      : 400
    return NextResponse.json({ error: msg }, { status })
  }
}
