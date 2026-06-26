import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdmin } from '@/lib/roles'
import { listarImagenes } from '@/lib/mailing-images'
import { getFromR2, keyFromPublicUrl } from '@/lib/cloudflare-r2'
import JSZip from 'jszip'

/**
 * /api/mailing/imagenes/descargar  (admin)
 *   GET ?id=<id>                      → descarga UNA imagen del banco (attachment).
 *   GET ?url=<url pública R2>         → descarga UNA imagen por su URL (las que muestra
 *                                       el agente en el chat con ![](URL)).
 *   GET [?origen=ai|upload][?grupo=…] → descarga TODAS (o el subconjunto) en un .zip.
 *
 * Se descarga a través del servidor (no del link público de R2) para FORZAR la
 * descarga: el atributo `download` del navegador se ignora en URLs de otro origen,
 * así que con un proxy mismo-origen + Content-Disposition: attachment el archivo
 * baja en vez de abrirse en una pestaña.
 */

// Armar el .zip de muchas imágenes puede tardar; damos margen.
export const maxDuration = 120

const CT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
}

/** Extensión a partir de la key (o, si no, de la URL); jpg por defecto. */
function extDe(key: string, url: string): string {
  const k = (key.split('.').pop() || '').toLowerCase()
  if (CT[k]) return k
  const u = (url.split('?')[0].split('.').pop() || '').toLowerCase()
  if (CT[u]) return u
  return 'jpg'
}

/** Nombre de archivo seguro a partir de la descripción (acentos → ascii, sin símbolos). */
function slug(s: string, fallback: string): string {
  const base = (s || '')
    .toLowerCase()
    .replace(/[áàäâ]/g, 'a').replace(/[éèëê]/g, 'e').replace(/[íìïî]/g, 'i')
    .replace(/[óòöô]/g, 'o').replace(/[úùüû]/g, 'u').replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return base || fallback
}

/** Respuesta de descarga de un archivo (attachment) mismo-origen. */
function attachment(buf: Buffer, ext: string, nombre: string): NextResponse {
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': CT[ext] || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${nombre}"`,
      'Content-Length': String(buf.byteLength),
      'Cache-Control': 'no-store',
    },
  })
}

async function requireAdmin(): Promise<NextResponse | null> {
  const session = await getServerSession(authOptions)
  if (!esAdmin((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  return null
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const id = req.nextUrl.searchParams.get('id')
  const url = req.nextUrl.searchParams.get('url')
  const origen = req.nextUrl.searchParams.get('origen') // 'ai' | 'upload' (opcional)
  const grupo = req.nextUrl.searchParams.get('grupo')   // opcional

  try {
    // ─── Descarga por URL pública de R2 (imágenes del chat del agente) ───
    if (url) {
      const key = keyFromPublicUrl(url) // null si no es una URL de nuestro R2
      if (!key) return NextResponse.json({ error: 'La URL no es una imagen de Alma Animal' }, { status: 400 })
      const buf = await getFromR2(key)
      if (!buf) return NextResponse.json({ error: 'No se pudo leer la imagen de R2' }, { status: 502 })
      const ext = extDe(key, url)
      const baseNombre = (key.split('/').pop() || 'imagen').replace(/\.[^.]+$/, '')
      return attachment(buf, ext, `${slug(baseNombre, 'imagen')}.${ext}`)
    }

    const todas = await listarImagenes()

    // ─── Descarga individual (por id del banco) ───
    if (id) {
      const img = todas.find(i => String(i.id) === String(id))
      if (!img) return NextResponse.json({ error: 'Imagen no encontrada' }, { status: 404 })
      const key = img.key || keyFromPublicUrl(img.url) || ''
      const buf = key ? await getFromR2(key) : null
      if (!buf) return NextResponse.json({ error: 'No se pudo leer la imagen de R2' }, { status: 502 })
      const ext = extDe(key, img.url)
      return attachment(buf, ext, `${slug(img.descripcion || img.alt, `imagen-${img.id}`)}.${ext}`)
    }

    // ─── Descarga masiva (.zip) ───
    let lista = todas
    if (origen === 'ai') lista = lista.filter(i => i.origen !== 'upload')
    else if (origen === 'upload') lista = lista.filter(i => i.origen === 'upload')
    if (grupo) lista = lista.filter(i => (i.grupo || '') === grupo)
    if (lista.length === 0) return NextResponse.json({ error: 'No hay imágenes para descargar' }, { status: 404 })

    const descargadas = await Promise.all(lista.map(async img => {
      const key = img.key || keyFromPublicUrl(img.url) || ''
      const buf = key ? await getFromR2(key) : null
      return { img, key, buf }
    }))

    const zip = new JSZip()
    const usados = new Set<string>()
    let agregadas = 0
    for (const { img, key, buf } of descargadas) {
      if (!buf) continue
      const ext = extDe(key, img.url)
      let nombre = `${slug(img.descripcion || img.alt, `imagen-${img.id}`)}-${img.id}.${ext}`
      while (usados.has(nombre)) nombre = `${img.id}-${nombre}`
      usados.add(nombre)
      zip.file(nombre, new Uint8Array(buf))
      agregadas++
    }
    if (agregadas === 0) return NextResponse.json({ error: 'No se pudieron leer las imágenes de R2' }, { status: 502 })

    const out = await zip.generateAsync({ type: 'uint8array' })
    // new Uint8Array(...) lo respalda en un ArrayBuffer (no ArrayBufferLike) → BodyInit válido.
    return new NextResponse(new Uint8Array(out), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="banco-imagenes-alma-animal.zip"',
        'Content-Length': String(out.byteLength),
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
