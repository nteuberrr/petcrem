import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { obtenerItem } from '@/lib/marketing-calendario'
import { getFromR2, keyFromPublicUrl } from '@/lib/cloudflare-r2'
import JSZip from 'jszip'

/**
 * GET /api/mailing/calendario/[id]/descargar  (admin)
 * Descarga las imágenes de una campaña social directamente desde el listado:
 *  - 1 imagen  → el archivo (attachment).
 *  - carrusel  → un .zip con todas, numeradas.
 * Mismo-origen + Content-Disposition para forzar la descarga (el link público de R2
 * se abriría en una pestaña).
 */
export const maxDuration = 120

const CT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4',
}
function extDe(url: string): string {
  const u = (url.split('?')[0].split('.').pop() || '').toLowerCase()
  return CT[u] ? u : 'jpg'
}
function slug(s: string, fallback: string): string {
  const base = (s || '').toLowerCase()
    .replace(/[áàäâ]/g, 'a').replace(/[éèëê]/g, 'e').replace(/[íìïî]/g, 'i')
    .replace(/[óòöô]/g, 'o').replace(/[úùüû]/g, 'u').replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)
  return base || fallback
}
/** Baja los bytes de una URL pública de R2 (o por fetch como fallback). */
async function bajar(url: string): Promise<Buffer | null> {
  const key = keyFromPublicUrl(url)
  let buf = key ? await getFromR2(key) : null
  if (!buf) { try { const r = await fetch(url); if (r.ok) buf = Buffer.from(await r.arrayBuffer()) } catch { /* ignore */ } }
  return buf
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!esAdminTotal((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  const { id } = await params
  try {
    const item = await obtenerItem(id)
    if (!item) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })

    let urls: string[] = []
    try {
      const a = item.imagenes_json ? JSON.parse(item.imagenes_json) : []
      if (Array.isArray(a)) urls = a.map((x: { url?: string }) => x?.url).filter((u): u is string => !!u)
    } catch { /* fallback abajo */ }
    if (urls.length === 0 && item.imagen_url) urls = [item.imagen_url]
    if (urls.length === 0) return NextResponse.json({ error: 'La campaña no tiene imágenes para descargar.' }, { status: 404 })

    const base = `campana-${id}-${slug(item.titulo || item.idea, 'campana')}`

    // Una sola imagen → descarga directa.
    if (urls.length === 1) {
      const buf = await bajar(urls[0])
      if (!buf) return NextResponse.json({ error: 'No se pudo leer la imagen.' }, { status: 502 })
      const ext = extDe(urls[0])
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          'Content-Type': CT[ext] || 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${base}.${ext}"`,
          'Content-Length': String(buf.byteLength),
          'Cache-Control': 'no-store',
        },
      })
    }

    // Carrusel → zip.
    const zip = new JSZip()
    let n = 0
    for (let i = 0; i < urls.length; i++) {
      const buf = await bajar(urls[i])
      if (buf) { zip.file(`${base}-${String(i + 1).padStart(2, '0')}.${extDe(urls[i])}`, new Uint8Array(buf)); n++ }
    }
    if (n === 0) return NextResponse.json({ error: 'No se pudieron leer las imágenes.' }, { status: 502 })
    const out = await zip.generateAsync({ type: 'uint8array' })
    return new NextResponse(new Uint8Array(out), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${base}.zip"`,
        'Content-Length': String(out.byteLength),
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
