import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, updateRow } from '@/lib/google-sheets'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const rows = await getSheetData('clientes')
    const idx = rows.findIndex((r) => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    const cliente = rows[idx]

    let ciclo = null
    if (cliente.ciclo_id) {
      const ciclos = await getSheetData('ciclos')
      ciclo = ciclos.find((c) => c.id === cliente.ciclo_id) ?? null
    }

    return NextResponse.json({ ...cliente, ciclo })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json()
    const rows = await getSheetData('clientes')
    const idx = rows.findIndex((r) => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    const updated = { ...rows[idx], ...body }
    await updateRow('clientes', idx, updated)
    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
