import { NextRequest, NextResponse } from 'next/server'
import { getSheetData } from '@/lib/google-sheets'
import { generarCertificadoBuffer, checkCertificateAssets } from '@/lib/certificate-generator'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Validate assets
    const assets = checkCertificateAssets()
    if (!assets.ok) {
      return NextResponse.json(
        { error: `Archivos de imagen faltantes en /public/certificates/: ${assets.missing.join(', ')}` },
        { status: 500 }
      )
    }

    // Load client
    const clientes = await getSheetData('clientes')
    const cliente = clientes.find(c => c.id === id)
    if (!cliente) return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 })
    if (cliente.estado !== 'cremado') {
      return NextResponse.json({ error: 'El proceso de cremación no ha sido completado' }, { status: 400 })
    }
    if (!cliente.ciclo_id) {
      return NextResponse.json({ error: 'Sin ciclo de cremación asignado' }, { status: 400 })
    }

    // Load cycle for cremation date
    const ciclos = await getSheetData('ciclos')
    const ciclo = ciclos.find(c => c.id === cliente.ciclo_id)
    if (!ciclo) return NextResponse.json({ error: 'Ciclo de cremación no encontrado' }, { status: 404 })

    // Generate PDF
    const buffer = await generarCertificadoBuffer({
      nombre_mascota:      cliente.nombre_mascota,
      especie:             cliente.especie,
      fecha_cremacion_raw: ciclo.fecha,
      nombre_tutor:        cliente.nombre_tutor,
      codigo:              cliente.codigo,
    })

    return new Response(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="certificado-${cliente.codigo}.pdf"`,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
