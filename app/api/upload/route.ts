import { NextRequest, NextResponse } from 'next/server'
import { uploadToR2 } from '@/lib/cloudflare-r2'
import { extFromMime } from '@/lib/nano-banana'

/**
 * POST /api/upload  — sube una imagen (FormData `file`) a Cloudflare R2 y devuelve
 * su URL pública. Lo usa la subida de fotos de productos (Configuración → Bodega).
 *
 * Antes subía a Google Drive (legacy, frágil para mostrar en <img>); migrado a R2
 * para alinear con el resto del sistema (banco, certificados, marca) y que la URL
 * sirva en la web Y en el catálogo PDF.
 */
export const maxDuration = 60

const MAX_BYTES = 10 * 1024 * 1024
const EXT_OK = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif'])

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const file = form.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No se recibió ningún archivo.' }, { status: 400 })

    const mime = (file.type || '').toLowerCase()
    if (!mime.startsWith('image/')) return NextResponse.json({ error: 'El archivo debe ser una imagen.' }, { status: 400 })
    const ext = extFromMime(mime)
    if (!EXT_OK.has(ext)) return NextResponse.json({ error: `Formato no soportado: ${mime}` }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    if (buffer.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: `La imagen excede ${(MAX_BYTES / 1024 / 1024).toFixed(0)}MB.` }, { status: 413 })
    }

    const safe = (file.name || 'foto').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-_]+/g, '-').slice(0, 40) || 'foto'
    const key = `productos/${Date.now()}-${safe}.${ext}`
    const { url } = await uploadToR2(buffer, key, mime)
    return NextResponse.json({ url })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[api/upload]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
