import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { estadoVideo } from '@/lib/veo'

/**
 * GET /api/mailing/videos/estado?op=operations/…  (admin)
 * Sondea el estado de una operación de Veo. Devuelve { done, uri?, error? }.
 * El cliente sondea cada pocos segundos; cuando done=true con uri, llama a
 * POST /api/mailing/videos { accion:'guardar', uri, … } UNA sola vez.
 */
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!esAdminTotal((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  const op = req.nextUrl.searchParams.get('op')
  if (!op) return NextResponse.json({ error: 'Falta op' }, { status: 400 })
  try {
    return NextResponse.json(await estadoVideo(op))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
