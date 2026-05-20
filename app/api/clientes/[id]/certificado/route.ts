import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, appendRow, getNextId, ensureSheet, ensureColumns } from '@/lib/google-sheets'
import { generarCertificadoBuffer, checkCertificateAssets, type FirmaInfo } from '@/lib/certificate-generator'
import { uploadToR2 } from '@/lib/cloudflare-r2'
import { firmarPDF, getSignerInfo, isSigningEnabled } from '@/lib/sign-pdf'
import { todayISO } from '@/lib/dates'

const CERT_COLS = [
  'id', 'cliente_id', 'codigo_mascota', 'nombre_mascota',
  'version',
  'fecha_emision', 'hora_emision',
  'emitido_por_id', 'emitido_por_nombre',
  'sin_foto', 'pdf_key', 'pdf_url',
  'fecha_creacion',
]

async function calcularVersion(clienteId: string): Promise<number> {
  try {
    await ensureSheet('certificados')
    await ensureColumns('certificados', CERT_COLS)
    const rows = await getSheetData('certificados')
    const existentes = rows.filter(r => r.cliente_id === clienteId).length
    return existentes + 1
  } catch {
    return 1
  }
}

function nombreArchivo(cliente: Record<string, string>, version: number): string {
  const sufijo = version > 1 ? `_V${version}` : ''
  return `Certificado_${cliente.nombre_mascota}_${cliente.codigo}${sufijo}.pdf`
}

async function obtenerDatosCliente(id: string) {
  const assets = checkCertificateAssets()
  if (!assets.ok) {
    throw new Error(`Archivos de imagen faltantes en /public/certificates/: ${assets.missing.join(', ')}`)
  }

  const clientes = await getSheetData('clientes')
  const cliente = clientes.find(c => c.id === id)
  if (!cliente) throw Object.assign(new Error('Cliente no encontrado'), { status: 404 })
  if (cliente.estado !== 'cremado' && cliente.estado !== 'despachado') {
    throw Object.assign(new Error('El proceso de cremación no ha sido completado'), { status: 400 })
  }
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

async function reservarIdCertificado(): Promise<string> {
  await ensureSheet('certificados')
  await ensureColumns('certificados', CERT_COLS)
  return getNextId('certificados')
}

function construirFirmaInfo(certId: string): FirmaInfo | null {
  const signer = getSignerInfo()
  if (!signer) return null
  return { signer_name: signer.name, fecha: new Date(), cert_id: certId }
}

async function persistirCertificado(opts: {
  certId: string
  cliente: Record<string, string>
  buffer: Buffer
  sinFoto: boolean
  filename: string
  version: number
}) {
  const { certId, cliente, buffer, sinFoto, filename, version } = opts
  try {
    const session = await getServerSession(authOptions)
    const emitidoPorId = (session?.user as { id?: string })?.id ?? ''
    const emitidoPorNombre = session?.user?.name || session?.user?.email || ''

    const key = `certificados/${cliente.codigo}/${filename}`
    const upload = await uploadToR2(buffer, key, 'application/pdf').catch(err => {
      console.error('[certificado] uploadToR2 falló:', err)
      return null
    })

    const now = new Date()
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')

    await appendRow('certificados', {
      id: certId,
      cliente_id: cliente.id,
      codigo_mascota: cliente.codigo,
      nombre_mascota: cliente.nombre_mascota,
      version,
      fecha_emision: todayISO(),
      hora_emision: `${hh}:${mm}`,
      emitido_por_id: emitidoPorId,
      emitido_por_nombre: emitidoPorNombre,
      sin_foto: sinFoto ? 'TRUE' : 'FALSE',
      pdf_key: upload?.key ?? '',
      pdf_url: upload?.url ?? '',
      fecha_creacion: todayISO(),
    })
  } catch (err) {
    // No bloqueamos la descarga del PDF si falla el registro: el usuario igual recibe el certificado.
    console.error('[certificado] persistencia falló:', err)
  }
}

async function generarYFirmar(
  cliente: Record<string, string>,
  ciclo: Record<string, string>,
  opts: { fotoBytes?: Uint8Array; sinFoto: boolean },
): Promise<{ buffer: Buffer; certId: string; version: number; filename: string; firmado: boolean }> {
  const certId = await reservarIdCertificado()
  const version = await calcularVersion(cliente.id)
  const filename = nombreArchivo(cliente, version)
  const firmaActiva = isSigningEnabled()
  const firmaInfo = firmaActiva ? construirFirmaInfo(certId) : null

  let buffer = await generarCertificadoBuffer({
    nombre_mascota:           cliente.nombre_mascota,
    especie:                  cliente.especie,
    fecha_cremacion_raw:      ciclo.fecha,
    nombre_tutor:             cliente.nombre_tutor,
    codigo:                   cliente.codigo,
    foto_bytes:               opts.fotoBytes,
    sin_foto:                 opts.sinFoto,
    firma_info:               firmaInfo ?? undefined,
    agregar_placeholder_firma: firmaActiva,
  })

  if (firmaActiva) {
    try {
      buffer = await firmarPDF(buffer)
    } catch (err) {
      // Si el sello visual ya dice "FIRMADO DIGITALMENTE" pero falla la firma cripto,
      // emitir el PDF sería engañoso. Cortamos.
      console.error('[certificado] firmarPDF falló:', err)
      throw Object.assign(new Error('Firma digital falló'), { status: 500 })
    }
  }

  return { buffer, certId, version, filename, firmado: firmaActiva }
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

    const { buffer, certId, version, filename } = await generarYFirmar(cliente, ciclo, { sinFoto: true })

    await persistirCertificado({ certId, cliente, buffer, sinFoto: true, filename, version })

    return pdfResponse(buffer, filename)
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

    const efectivoSinFoto = sinFoto || !fotoBytes

    const { buffer, certId, version, filename } = await generarYFirmar(cliente, ciclo, {
      fotoBytes,
      sinFoto: efectivoSinFoto,
    })

    await persistirCertificado({ certId, cliente, buffer, sinFoto: efectivoSinFoto, filename, version })

    return pdfResponse(buffer, filename)
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string }
    return NextResponse.json({ error: err.message ?? String(e) }, { status: err.status ?? 500 })
  }
}
