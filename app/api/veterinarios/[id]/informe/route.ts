import { NextRequest, NextResponse } from 'next/server'
import { generarInformeVeterinaria } from '@/lib/informe-veterinaria'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const informe = await generarInformeVeterinaria(id)
    return NextResponse.json(informe)
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string }
    return NextResponse.json({ error: err.message ?? String(e) }, { status: err.status ?? 500 })
  }
}
