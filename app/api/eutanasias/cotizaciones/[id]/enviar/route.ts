import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { enviarCotizacionAVets } from '@/lib/eutanasia-cotizaciones'
import { esAdmin } from '@/lib/roles'

/**
 * POST /api/eutanasias/cotizaciones/[id]/enviar
 * body: { vet_ids: string[] }
 *
 * Envía la cotización por mail a cada vet indicado (token 'aceptar' + HTML del
 * caso). La lógica vive en lib/eutanasia-cotizaciones (compartida con el bot).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!esAdmin((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  try {
    const { id } = await params
    const body = await req.json()
    const vetIds: string[] = Array.isArray(body.vet_ids) ? body.vet_ids.map(String) : []
    if (vetIds.length === 0) return NextResponse.json({ error: 'No seleccionaste ningún veterinario' }, { status: 400 })

    const res = await enviarCotizacionAVets({ cotiId: id, vetIds })
    return NextResponse.json({ ok: true, ...res })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[eutanasias/enviar] error:', msg)
    // Errores de validación conocidos → 400; el resto → 500.
    const is400 = /no encontrada|ya está en estado|Ningún veterinario|No se indicó/i.test(msg)
    return NextResponse.json({ error: msg }, { status: is400 ? 400 : 500 })
  }
}
