import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, moveRow } from '@/lib/google-sheets'

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const tipo = searchParams.get('tipo') ?? 'general'
    const body = await req.json()
    const { id, direction } = body as { id: string; direction: 'up' | 'down' }
    if (!id || !direction) return NextResponse.json({ error: 'id y direction requeridos' }, { status: 400 })

    const hoja = tipo === 'convenio' ? 'precios_convenio'
      : tipo === 'especial' ? 'precios_especiales'
      : 'precios_generales'

    const rows = await getSheetData(hoja)
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    if (direction === 'up' && idx === 0) return NextResponse.json({ ok: true, noop: true })
    if (direction === 'down' && idx === rows.length - 1) return NextResponse.json({ ok: true, noop: true })

    await moveRow(hoja, idx, direction)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
