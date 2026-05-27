import { NextResponse } from 'next/server'
import { getSheetData, ensureSheet, ensureColumns } from '@/lib/google-sheets'

const INFORMES_COLS = [
  'id', 'veterinaria_id', 'veterinaria_nombre',
  'version', 'formato',
  'periodo_hasta_mes', 'cantidad_meses', 'cantidad_fichas', 'monto_total_clp',
  'fecha_emision', 'hora_emision',
  'emitido_por_id', 'emitido_por_nombre',
  'archivo_key', 'archivo_url',
  'fecha_creacion',
]

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await ensureSheet('informes_veterinaria')
    await ensureColumns('informes_veterinaria', INFORMES_COLS)
    const rows = await getSheetData('informes_veterinaria')
    const propios = rows
      .filter(r => r.veterinaria_id === id)
      .sort((a, b) => (parseInt(b.version) || 0) - (parseInt(a.version) || 0))
    return NextResponse.json(propios)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
