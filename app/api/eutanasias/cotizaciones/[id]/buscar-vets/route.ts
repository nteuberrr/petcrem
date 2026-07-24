import { NextRequest, NextResponse } from 'next/server'
import { getSheetData } from '@/lib/datastore'
import { matchVetsConDiagnostico } from '@/lib/eutanasia-matcher'
import { sesionConAcceso } from '@/lib/permisos-server'

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
  const { ok } = await sesionConAcceso('/api/eutanasias')
  if (!ok) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  void req
  try {
    const { id } = await params
    const cotis = await getSheetData('cotizaciones_eutanasia')
    const c = cotis.find(r => r.id === id)
    if (!c) return NextResponse.json({ error: 'Cotización no encontrada' }, { status: 404 })

    const vets = await getSheetData('vet_convenio_eutanasia')
    const resultado = matchVetsConDiagnostico(vets, c.comuna, c.fecha_servicio, c.hora_servicio)
    return NextResponse.json({
      cotizacion: { id: c.id, comuna: c.comuna, fecha_servicio: c.fecha_servicio, hora_servicio: c.hora_servicio },
      total: resultado.matched.length,
      total_vets_evaluados: vets.length,
      vets: resultado.matched,
      excluidos: resultado.excluidos,
      diagnostico: {
        comuna_canonica: resultado.comuna_canonica,
        dia_resuelto: resultado.horario_ref?.dia ?? null,
        slot_resuelto: resultado.horario_ref?.slots.join('+') ?? null,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
