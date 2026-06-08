import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { uploadToR2 } from '@/lib/cloudflare-r2'
import { esAdmin } from '@/lib/roles'

/**
 * POST /api/mailing/upload-image
 *
 * Body (JSON):
 *   { data_url: "data:image/png;base64,...", filename?: "header.png" }
 *
 * Sube la imagen a R2 en mailing/inline-images/<timestamp>-<filename>.<ext>
 * Devuelve la URL pública. Pensado para "rescatar" imágenes embebidas en data:base64
 * cuando el usuario carga un .html exportado desde Canva u otro editor visual
 * (esos clientes muchas veces inlinean las imágenes y Gmail las bloquea).
 *
 * Límite por imagen: 8MB (alineado con el límite seguro para inline en mail clients).
 */
const MAX_BYTES = 8 * 1024 * 1024

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
}

function safeBase(name: string | undefined): string {
  if (!name) return 'image'
  return name
    .replace(/\.[^.]+$/, '')                 // sin extensión
    .replace(/[^\w-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 60) || 'image'
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!esAdmin((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }

  try {
    const { data_url, filename } = await req.json() as { data_url?: string; filename?: string }
    if (!data_url || typeof data_url !== 'string') {
      return NextResponse.json({ error: 'data_url requerido' }, { status: 400 })
    }
    const m = data_url.match(/^data:([\w/+.-]+);base64,(.*)$/i)
    if (!m) return NextResponse.json({ error: 'data_url no es base64 válido' }, { status: 400 })
    const mime = m[1].toLowerCase()
    const b64 = m[2]
    if (!EXT_BY_MIME[mime]) {
      return NextResponse.json({ error: `mime no soportado: ${mime}` }, { status: 400 })
    }
    const buf = Buffer.from(b64, 'base64')
    if (buf.byteLength > MAX_BYTES) {
      return NextResponse.json({
        error: `imagen excede ${(MAX_BYTES / 1024 / 1024).toFixed(0)}MB (${(buf.byteLength / 1024 / 1024).toFixed(1)}MB)`,
      }, { status: 413 })
    }

    const ext = EXT_BY_MIME[mime]
    const ts = Date.now()
    const base = safeBase(filename)
    const key = `mailing/inline-images/${ts}-${base}.${ext}`
    const up = await uploadToR2(buf, key, mime)

    return NextResponse.json({ ok: true, url: up.url, key: up.key, size: buf.byteLength, mime })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[mailing/upload-image]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
