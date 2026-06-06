import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, updateRow } from '@/lib/google-sheets'
import { todayISO } from '@/lib/dates'

export const dynamic = 'force-dynamic'

/**
 * POST /api/despachos/[id]/terminar
 * Cierra la ruta: fija hora_termino_ruta, fecha_realizada y estado 'terminada'.
 * Devuelve cuántas mascotas quedaron sin entregar (informativo para el front).
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const rows = await getSheetData('despachos')
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'Ruta no encontrada' }, { status: 404 })
    const row = rows[idx]

    let mascotasIds: string[] = []
    try { mascotasIds = JSON.parse(row.mascotas_ids || '[]') } catch {}
    let entregas: Record<string, { fecha_hora: string }> = {}
    try { entregas = JSON.parse(row.entregas || '{}') } catch {}
    const sinEntregar = mascotasIds.filter(mid => !entregas[mid]).length

    const now = new Date().toISOString()
    await updateRow('despachos', idx, {
      ...row,
      estado_ruta: 'terminada',
      hora_termino_ruta: row.hora_termino_ruta || now,
      hora_inicio_ruta: row.hora_inicio_ruta || now,
      fecha_realizada: row.fecha_realizada || todayISO(),
    })

    return NextResponse.json({ ok: true, hora_termino_ruta: now, sin_entregar: sinEntregar })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
