import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSheetData, appendRow, updateRow, getNextId } from '@/lib/google-sheets'

const VetSchema = z.object({
  nombre: z.string().min(1),
  direccion: z.string(),
  telefono: z.string(),
  correo: z.string(),
  nombre_contacto: z.string(),
  cargo_contacto: z.string(),
  comuna: z.string(),
  rut: z.string(),
  razon_social: z.string(),
  giro: z.string(),
  tipo_precios: z.enum(['precios_convenio', 'precios_especiales']),
  precios_especiales: z.string().optional().default(''),
  activo: z.boolean().optional().default(true),
})

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const soloActivos = searchParams.get('activo') === 'true'
    let rows = await getSheetData('veterinarios')
    if (soloActivos) rows = rows.filter((r) => r.activo === 'TRUE')
    return NextResponse.json(rows)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const data = VetSchema.parse(body)
    const id = await getNextId('veterinarios')
    const now = new Date().toISOString().split('T')[0]
    const row = { id, ...data, activo: 'TRUE', fecha_creacion: now }
    await appendRow('veterinarios', row)
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { id, ...updates } = body
    const rows = await getSheetData('veterinarios')
    const idx = rows.findIndex((r) => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    const updated = { ...rows[idx], ...updates }
    await updateRow('veterinarios', idx, updated)
    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}
