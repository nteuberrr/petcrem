import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, appendRow, updateRow, getNextId } from '@/lib/google-sheets'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const tipo = searchParams.get('tipo') ?? 'general'
    const hoja = tipo === 'convenio' ? 'precios_convenio' : 'precios_generales'
    const rows = await getSheetData(hoja)
    return NextResponse.json(rows)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const tipo = searchParams.get('tipo') ?? 'general'
    const hoja = tipo === 'convenio' ? 'precios_convenio' : 'precios_generales'
    const body = await req.json()
    const id = await getNextId(hoja)
    const row = {
      id,
      peso_min: String(body.peso_min),
      peso_max: String(body.peso_max),
      precio_ci: String(body.precio_ci),
      precio_cp: String(body.precio_cp),
      precio_sd: String(body.precio_sd),
    }
    await appendRow(hoja, row)
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const tipo = searchParams.get('tipo') ?? 'general'
    const hoja = tipo === 'convenio' ? 'precios_convenio' : 'precios_generales'
    const body = await req.json()
    const { id, ...updates } = body
    const rows = await getSheetData(hoja)
    const idx = rows.findIndex((r) => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    const updated = { ...rows[idx], ...updates }
    await updateRow(hoja, idx, updated)
    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}
