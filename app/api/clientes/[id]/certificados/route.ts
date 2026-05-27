import { NextResponse } from 'next/server'
import { getSheetData, ensureSheet, ensureColumns } from '@/lib/google-sheets'

const CERT_COLS = [
  'id', 'cliente_id', 'codigo_mascota', 'nombre_mascota',
  'version',
  'fecha_emision', 'hora_emision',
  'emitido_por_id', 'emitido_por_nombre',
  'sin_foto', 'pdf_key', 'pdf_url',
  'fecha_creacion',
]

/**
 * Lista los certificados emitidos para un cliente, ordenados por versión descendente
 * (el más reciente primero). Cada certificado mantiene su `pdf_url` en R2, así que la
 * UI puede ofrecer descargar versiones previas o reenviar la última.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await ensureSheet('certificados')
    await ensureColumns('certificados', CERT_COLS)
    const rows = await getSheetData('certificados')
    const propios = rows
      .filter(r => r.cliente_id === id)
      .sort((a, b) => (parseInt(b.version) || 0) - (parseInt(a.version) || 0))
    return NextResponse.json(propios)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
