import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { getAgenteConfig, updateAgenteConfig } from '@/lib/mensajes'

export const dynamic = 'force-dynamic'

/** Defensa en profundidad: además del proxy, revalidamos rol admin-total acá. */
async function noAutorizado(): Promise<boolean> {
  const session = await getServerSession(authOptions)
  return !esAdminTotal((session?.user as { role?: string })?.role)
}

/** GET: config actual del agente. (Admin-only vía proxy.) */
export async function GET() {
  try {
    if (await noAutorizado()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    return NextResponse.json(await getAgenteConfig())
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

/** PUT: actualiza instrucciones y/o calibración (texto editable). */
export async function PUT(req: NextRequest) {
  try {
    if (await noAutorizado()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    const b = await req.json().catch(() => ({}))
    const patch: { instrucciones?: string; calibracion?: string } = {}
    if (typeof b.instrucciones === 'string') patch.instrucciones = b.instrucciones
    if (typeof b.calibracion === 'string') patch.calibracion = b.calibracion
    const cfg = await updateAgenteConfig(patch)
    return NextResponse.json(cfg)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
