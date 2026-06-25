import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { listarVideos, eliminarVideo, guardarVideo } from '@/lib/mailing-videos'
import { lanzarVideo, isVeoConfigurado } from '@/lib/veo'

/**
 * /api/mailing/videos  (admin)
 *   GET                          → lista el banco de videos
 *   POST { accion: 'lanzar', prompt, imagen_url?, aspect?, resolution?, duracion? }
 *        → lanza la generación con Veo (async) y devuelve { operation }
 *   POST { accion: 'guardar', uri, prompt, descripcion?, imagen_origen?, aspect?, duracion? }
 *        → descarga el video terminado, lo sube a R2 y lo registra → { video }
 *   DELETE ?id=…                 → elimina un video
 *
 * El sondeo del estado va por /api/mailing/videos/estado?op=…
 */

export const maxDuration = 120

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!esAdminTotal((session?.user as { role?: string })?.role)) {
    return { denied: NextResponse.json({ error: 'Solo admin' }, { status: 403 }), session: null }
  }
  return { denied: null, session }
}

export async function GET() {
  const { denied } = await requireAdmin()
  if (denied) return denied
  try {
    return NextResponse.json(await listarVideos())
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const { denied, session } = await requireAdmin()
  if (denied) return denied
  if (!isVeoConfigurado()) {
    return NextResponse.json({ error: 'Generación de video no disponible (falta GEMINI_API_KEY).' }, { status: 400 })
  }
  const creadoPor = session?.user?.name || session?.user?.email || ''
  try {
    const body = await req.json() as {
      accion?: string
      prompt?: string
      imagen_url?: string
      imagen_origen?: string
      aspect?: string
      resolution?: string
      duracion?: string
      descripcion?: string
      uri?: string
    }

    if (body.accion === 'lanzar') {
      if (!body.prompt?.trim()) return NextResponse.json({ error: 'Falta el prompt del video.' }, { status: 400 })
      let imagen: { data: Buffer; mime: string } | undefined
      if (body.imagen_url) {
        try {
          const rr = await fetch(body.imagen_url)
          if (rr.ok) imagen = { data: Buffer.from(await rr.arrayBuffer()), mime: rr.headers.get('content-type') || 'image/jpeg' }
        } catch { /* sin imagen base: queda text-to-video */ }
      }
      const operation = await lanzarVideo({
        prompt: body.prompt.trim(),
        imagen,
        aspect: body.aspect,
        resolution: body.resolution,
        durationSeconds: body.duracion,
      })
      return NextResponse.json({ operation })
    }

    if (body.accion === 'guardar') {
      if (!body.uri) return NextResponse.json({ error: 'Falta la uri del video.' }, { status: 400 })
      const video = await guardarVideo({
        uri: body.uri,
        prompt: body.prompt || '',
        descripcion: body.descripcion,
        imagenOrigen: body.imagen_origen,
        aspect: body.aspect,
        duracion: body.duracion,
        creadoPor,
      })
      return NextResponse.json({ video })
    }

    return NextResponse.json({ error: 'Acción inválida (lanzar | guardar).' }, { status: 400 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[mailing/videos]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const { denied } = await requireAdmin()
  if (denied) return denied
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 })
  try {
    await eliminarVideo(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
