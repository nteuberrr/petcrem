import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData } from '@/lib/datastore'
import { getPresignedPutUrl } from '@/lib/cloudflare-r2'

// POST /api/clientes/[id]/foto-evidencia/presign
// body: { content_type: string }
// URL prefirmada para subir la foto de EVIDENCIA del peso DIRECTO a R2 (el
// navegador hace el PUT, evita el límite de body de Vercel — fotos de celular
// pueden ser grandes). Se guarda en la misma carpeta del cliente que los videos.

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const contentType = String(body.content_type || '').toLowerCase()
    const ext = EXT[contentType]
    if (!ext) {
      return NextResponse.json({ error: 'Formato de imagen no soportado (usa JPG, PNG o WebP).' }, { status: 400 })
    }

    const clientes = await getSheetData('clientes')
    const cliente = clientes.find(c => c.id === id)
    if (!cliente) return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 })

    const carpeta = cliente.codigo || cliente.id
    const key = `clientes/${carpeta}/fotos/${Date.now()}.${ext}`
    const presigned = await getPresignedPutUrl(key, contentType)
    return NextResponse.json(presigned)
  } catch (e) {
    console.error('[foto-evidencia/presign]', e)
    return NextResponse.json({ error: 'No se pudo preparar la subida.' }, { status: 500 })
  }
}
