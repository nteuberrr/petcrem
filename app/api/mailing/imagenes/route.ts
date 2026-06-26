import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdmin } from '@/lib/roles'
import { uploadToR2 } from '@/lib/cloudflare-r2'
import { listarImagenes, registrarImagen, generarYGuardarImagen, eliminarImagen, actualizarImagen } from '@/lib/mailing-images'
import { isNanoBananaConfigurado, extFromMime } from '@/lib/nano-banana'

// La generación con Nano Banana Pro puede tardar; damos margen.
export const maxDuration = 120

const MAX_BYTES = 8 * 1024 * 1024
const EXT_OK = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif'])

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!esAdmin((session?.user as { role?: string })?.role)) {
    return { denied: NextResponse.json({ error: 'Solo admin' }, { status: 403 }), session: null }
  }
  return { denied: null, session }
}

/** GET — lista el banco de imágenes. */
export async function GET() {
  const { denied } = await requireAdmin()
  if (denied) return denied
  try {
    const imgs = await listarImagenes()
    return NextResponse.json(imgs)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

/**
 * POST — agrega una imagen al banco. Dos modos:
 *   { generar: { prompt, alt?, descripcion?, tags?, aspect? } }  → genera con Nano Banana Pro
 *   { data_url, descripcion?, alt?, tags? }                      → sube una imagen propia (base64)
 */
export async function POST(req: NextRequest) {
  const { denied, session } = await requireAdmin()
  if (denied) return denied
  const creadoPor = session?.user?.name || session?.user?.email || ''

  try {
    const body = await req.json() as {
      generar?: { prompt?: string; alt?: string; descripcion?: string; tags?: string; aspect?: string; grupo?: string }
      data_url?: string
      descripcion?: string
      alt?: string
      tags?: string
      grupo?: string
      whatsapp?: boolean
    }

    // Modo 1: generar con IA.
    if (body.generar?.prompt?.trim()) {
      if (!isNanoBananaConfigurado()) {
        return NextResponse.json({ error: 'Generación no disponible (falta GEMINI_API_KEY).' }, { status: 400 })
      }
      const g = body.generar
      const { imagen } = await generarYGuardarImagen({
        prompt: g.prompt!.trim(),
        alt: g.alt,
        descripcion: g.descripcion || g.alt,
        tags: g.tags,
        grupo: g.grupo,
        aspect: g.aspect,
        creadoPor,
      })
      if (body.whatsapp) { await actualizarImagen(imagen.id, { whatsapp: true }); imagen.whatsapp = true }
      return NextResponse.json(imagen)
    }

    // Modo 2: subir imagen propia (data:base64).
    if (body.data_url) {
      const m = body.data_url.match(/^data:(image\/[\w.+-]+);base64,(.*)$/i)
      if (!m) return NextResponse.json({ error: 'data_url no es una imagen base64 válida' }, { status: 400 })
      const mime = m[1].toLowerCase()
      const ext = extFromMime(mime)
      if (!EXT_OK.has(ext)) return NextResponse.json({ error: `formato no soportado: ${mime}` }, { status: 400 })
      const buf = Buffer.from(m[2], 'base64')
      if (buf.byteLength > MAX_BYTES) {
        return NextResponse.json({ error: `imagen excede ${(MAX_BYTES / 1024 / 1024).toFixed(0)}MB` }, { status: 413 })
      }
      const key = `mailing/uploads/${Date.now()}.${ext}`
      const up = await uploadToR2(buf, key, mime)
      const img = await registrarImagen({
        url: up.url, key: up.key,
        descripcion: body.descripcion || body.alt || '',
        alt: body.alt || body.descripcion || '',
        tags: body.tags || '',
        grupo: body.grupo || '',
        whatsapp: !!body.whatsapp,
        origen: 'upload',
        creadoPor,
      })
      return NextResponse.json(img)
    }

    return NextResponse.json({ error: 'Falta "generar.prompt" o "data_url".' }, { status: 400 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[mailing/imagenes]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/** PATCH ?id=… — reasigna grupo / descripción / tags / flag whatsapp / favorita de una imagen. */
export async function PATCH(req: NextRequest) {
  const { denied } = await requireAdmin()
  if (denied) return denied
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 })
  try {
    const body = await req.json() as { grupo?: string; descripcion?: string; tags?: string; whatsapp?: boolean; favorita?: boolean }
    await actualizarImagen(id, body)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

/** DELETE ?id=… — elimina una imagen del banco (y de R2 best-effort). */
export async function DELETE(req: NextRequest) {
  const { denied } = await requireAdmin()
  if (denied) return denied
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 })
  try {
    await eliminarImagen(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
