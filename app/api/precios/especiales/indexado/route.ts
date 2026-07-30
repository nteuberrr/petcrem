import { NextRequest, NextResponse } from 'next/server'
import { activarIndexado, desactivarIndexado, esOrigenIndexable } from '@/lib/precios-indexados'

/**
 * Indexado de la tabla de precios especiales de una veterinaria a una tabla base.
 *
 *  POST   { veterinaria_id, origen: 'general' | 'convenio' } → indexa y copia ya mismo
 *  DELETE { veterinaria_id }                                 → deja los tramos como tarifa propia
 *
 * Lo normal es hacerlo desde el modal "Duplicar" (que copia + indexa en un paso);
 * esto es para activarlo o soltarlo sin volver a duplicar.
 */
export async function POST(req: NextRequest) {
  try {
    const { veterinaria_id, origen } = await req.json() as { veterinaria_id?: string; origen?: string }
    const vid = String(veterinaria_id ?? '').trim()
    if (!vid) return NextResponse.json({ error: 'veterinaria_id requerido' }, { status: 400 })
    if (!esOrigenIndexable(origen)) {
      return NextResponse.json({ error: "origen inválido: solo 'general' o 'convenio'." }, { status: 400 })
    }
    const r = await activarIndexado(vid, origen)
    return NextResponse.json({ ok: true, indexado: origen, tramos: r.tramos })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { veterinaria_id } = await req.json().catch(() => ({})) as { veterinaria_id?: string }
    const vid = String(veterinaria_id ?? '').trim()
    if (!vid) return NextResponse.json({ error: 'veterinaria_id requerido' }, { status: 400 })
    await desactivarIndexado(vid)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 })
  }
}
