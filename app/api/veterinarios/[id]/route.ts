import { NextRequest, NextResponse } from 'next/server'
import { getSheetData } from '@/lib/google-sheets'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const [vets, clientes, preciosE] = await Promise.all([
      getSheetData('veterinarios'),
      getSheetData('clientes'),
      getSheetData('precios_especiales').catch(() => []),
    ])

    const vet = vets.find(v => v.id === id)
    if (!vet) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    const clientesDeEsteVet = clientes.filter(c => c.veterinaria_id === id)
    const tramos = preciosE.filter(pe => pe.veterinaria_id === id)

    return NextResponse.json({ ...vet, clientes: clientesDeEsteVet, tramos_especiales: tramos })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
