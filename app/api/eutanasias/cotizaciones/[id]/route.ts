import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, updateRow, deleteRow } from '@/lib/google-sheets'

const SHEET = 'cotizaciones_eutanasia'

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if ((session?.user as { role?: string })?.role !== 'admin') {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  return null
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied
  void req
  try {
    const { id } = await params
    const rows = await getSheetData(SHEET)
    const found = rows.find(r => r.id === id)
    if (!found) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    return NextResponse.json(found)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

const CAMPOS_EDITABLES = [
  'mascota_nombre', 'especie', 'peso',
  'cliente_nombre', 'cliente_telefono', 'cliente_email',
  'direccion', 'comuna',
  'fecha_servicio', 'hora_servicio',
  'notas',
  'estado',
] as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { id } = await params
    const body = await req.json()
    const rows = await getSheetData(SHEET)
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    const partial: Record<string, string> = {}
    for (const campo of CAMPOS_EDITABLES) {
      if (campo in body) partial[campo] = String(body[campo] ?? '')
    }
    // Marcadores de timestamp si cambia el estado a algunos específicos
    if (partial.estado === 'realizada' && !rows[idx].fecha_realizacion) {
      partial.fecha_realizacion = new Date().toISOString()
    }
    if (partial.estado === 'cancelada' && !rows[idx].fecha_cancelacion) {
      partial.fecha_cancelacion = new Date().toISOString()
    }
    const updated = { ...rows[idx], ...partial }
    await updateRow(SHEET, idx, updated)
    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied
  void req
  try {
    const { id } = await params
    const rows = await getSheetData(SHEET)
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    await deleteRow(SHEET, idx)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
