import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData } from '@/lib/google-sheets'
import { matchVets } from '@/lib/eutanasia-matcher'

/**
 * POST /api/eutanasias/cotizaciones/[id]/buscar-vets
 *
 * Dada una cotización existente, busca los vets del convenio que cumplen:
 * - activo
 * - cubren la comuna
 * - tienen disponibilidad en el día/horario del servicio
 *
 * Devuelve la lista con datos suficientes para mostrar en la UI y
 * permitir disparar el envío.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if ((session?.user as { role?: string })?.role !== 'admin') {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  void req
  try {
    const { id } = await params
    const cotis = await getSheetData('cotizaciones_eutanasia')
    const c = cotis.find(r => r.id === id)
    if (!c) return NextResponse.json({ error: 'Cotización no encontrada' }, { status: 404 })

    const vets = await getSheetData('vet_convenio_eutanasia')
    const matches = matchVets(vets, c.comuna, c.fecha_servicio, c.hora_servicio)
    return NextResponse.json({
      cotizacion: { id: c.id, comuna: c.comuna, fecha_servicio: c.fecha_servicio, hora_servicio: c.hora_servicio },
      total: matches.length,
      vets: matches,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
