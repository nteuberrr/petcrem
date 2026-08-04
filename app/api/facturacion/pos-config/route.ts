import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getConfigPos, setConfigPos } from '@/lib/facturacion-pos'
import { puedeNivel } from '@/lib/permisos-server'
import { todayISO } from '@/lib/dates'

export const dynamic = 'force-dynamic'

const Cfg = z.object({
  comision_fija: z.coerce.number().min(0).max(100000),
  // El porcentaje se guarda como número (0,79 = 0,79%), no como fracción.
  comision_variable: z.coerce.number().min(0).max(100),
  iva: z.coerce.number().min(0).max(100),
})

/** GET: comisión configurada del procesador de pagos. */
export async function GET() {
  if (!(await puedeNivel('facturacion', 'ver'))) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
  }
  return NextResponse.json(await getConfigPos())
}

/** PUT: actualiza la comisión (fija, variable e IVA). */
export async function PUT(req: NextRequest) {
  if (!(await puedeNivel('facturacion', 'editar'))) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
  }
  try {
    const parsed = Cfg.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' }, { status: 400 })
    }
    await setConfigPos(parsed.data, todayISO())
    return NextResponse.json(await getConfigPos())
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 })
  }
}
