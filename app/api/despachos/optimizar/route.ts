import { NextRequest, NextResponse } from 'next/server'
import { optimizarRuta } from '@/lib/route-optimizer'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as {
      origin_address?: string
      destination_address?: string
      max_detour_minutes?: number
      dias_recomendadas?: number
      fecha_base?: string
      incluir_extras_ids?: string[]
    }
    if (!body.origin_address || !body.origin_address.trim()) {
      return NextResponse.json({ error: 'origin_address es requerido' }, { status: 400 })
    }
    const result = await optimizarRuta({
      origin_address: body.origin_address,
      destination_address: body.destination_address,
      max_detour_minutes: body.max_detour_minutes,
      dias_recomendadas: body.dias_recomendadas,
      fecha_base: body.fecha_base,
      incluir_extras_ids: body.incluir_extras_ids,
    })
    return NextResponse.json(result)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[optimizar] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
