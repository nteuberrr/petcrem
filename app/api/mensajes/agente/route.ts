import { NextRequest, NextResponse } from 'next/server'
import { getAgenteConfig, updateAgenteConfig } from '@/lib/mensajes'

export const dynamic = 'force-dynamic'

/** GET: config actual del agente. (Admin-only vía proxy.) */
export async function GET() {
  try {
    return NextResponse.json(await getAgenteConfig())
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

/** PUT: actualiza instrucciones y/o calibración (texto editable). */
export async function PUT(req: NextRequest) {
  try {
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
