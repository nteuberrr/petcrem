import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData } from '@/lib/datastore'
import { getPresignedPutUrl } from '@/lib/cloudflare-r2'

// POST /api/clientes/[id]/video/presign
// body: { filename?: string, content_type: string }
// Devuelve una URL prefirmada para subir el video DIRECTO a R2 (el navegador
// hace el PUT, evitando el límite de body de Vercel). Auth: sesión requerida.

const EXT: Record<string, string> = {
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'video/3gpp': '3gp', 'video/x-matroska': 'mkv',
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
      return NextResponse.json({ error: 'Formato de video no soportado (usa MP4, MOV o WebM).' }, { status: 400 })
    }

    const clientes = await getSheetData('clientes')
    const cliente = clientes.find(c => c.id === id)
    if (!cliente) return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 })

    const carpeta = cliente.codigo || cliente.id
    const key = `clientes/${carpeta}/videos/${Date.now()}.${ext}`
    const presigned = await getPresignedPutUrl(key, contentType)
    return NextResponse.json(presigned)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
