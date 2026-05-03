import { NextRequest, NextResponse } from 'next/server'
import { getSheetData } from '@/lib/google-sheets'
import { generarCertificadoBuffer, checkCertificateAssets } from '@/lib/certificate-generator'

async function obtenerDatosCliente(id: string) {
  const assets = checkCertificateAssets()
  if (!assets.ok) {
    throw new Error(`Archivos de imagen faltantes en /public/certificates/: ${assets.missing.join(', ')}`)
  }

  const clientes = await getSheetData('clientes')
  const cliente = clientes.find(c => c.id === id)
  if (!cliente) throw Object.assign(new Error('Cliente no encontrado'), { status: 404 })
  if (cliente.estado !== 'cremado') throw Object.assign(new Error('El proceso de cremación no ha sido completado'), { status: 400 })
  if (!cliente.ciclo_id) throw Object.assign(new Error('Sin ciclo de cremación asignado'), { status: 400 })

  const ciclos = await getSheetData('ciclos')
  const ciclo = ciclos.find(c => c.id === cliente.ciclo_id)
  if (!ciclo) throw Object.assign(new Error('Ciclo de cremación no encontrado'), { status: 404 })

  return { cliente, ciclo }
}

function pdfResponse(buffer: Buffer, filename: string): Response {
  return new Response(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

/**
 * GET → genera certificado SIN foto. Mantenido por compatibilidad.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { cliente, ciclo } = await obtenerDatosCliente(id)

    const buffer = await generarCertificadoBuffer({
      nombre_mascota:      cliente.nombre_mascota,
      especie:             cliente.especie,
      fecha_cremacion_raw: ciclo.fecha,
      nombre_tutor:        cliente.nombre_tutor,
      codigo:              cliente.codigo,
      sin_foto:            true,
    })

    return pdfResponse(buffer, `Certificado_${cliente.nombre_mascota}_${cliente.codigo}.pdf`)
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string }
    return NextResponse.json({ error: err.message ?? String(e) }, { status: err.status ?? 500 })
  }
}

/**
 * POST → genera certificado con foto opcional.
 * Body: FormData con campos:
 *   - foto: File (opcional)
 *   - sin_foto: "true" | "false" (opcional, default false)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { cliente, ciclo } = await obtenerDatosCliente(id)

    const form = await req.formData()
    const sinFoto = form.get('sin_foto') === 'true'
    const fotoField = form.get('foto')

    let fotoBytes: Uint8Array | undefined
    if (!sinFoto && fotoField && fotoField instanceof File && fotoField.size > 0) {
      const ab = await fotoField.arrayBuffer()
      fotoBytes = new Uint8Array(ab)
    }

    const buffer = await generarCertificadoBuffer({
      nombre_mascota:      cliente.nombre_mascota,
      especie:             cliente.especie,
      fecha_cremacion_raw: ciclo.fecha,
      nombre_tutor:        cliente.nombre_tutor,
      codigo:              cliente.codigo,
      foto_bytes:          fotoBytes,
      sin_foto:            sinFoto || !fotoBytes,
    })

    return pdfResponse(buffer, `Certificado_${cliente.nombre_mascota}_${cliente.codigo}.pdf`)
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string }
    return NextResponse.json({ error: err.message ?? String(e) }, { status: err.status ?? 500 })
  }
}
