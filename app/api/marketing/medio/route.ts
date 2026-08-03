import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdmin } from '@/lib/roles'

/**
 * GET /api/marketing/medio?u=<url>  (admin-only)
 *
 * Sirve desde NUESTRO origen una imagen, un audio, un VIDEO o una fuente que
 * vive en R2. Hace falta por dos motivos: el canvas se "ensucia" (tainted) con
 * recursos de otro origen y deja de poder capturarse, y `r2.dev` lo bloquean
 * varias extensiones/adblockers — al dueño le aparecía "el sitio no está
 * disponible" al abrir el link del MP4 aunque R2 lo servía perfecto. Es el
 * mismo motivo por el que existe /api/mailing/img-proxy para las campañas.
 *
 * Con `?descargar=1` fuerza la descarga en vez de abrirlo en el navegador (el
 * atributo `download` de un <a> no funciona cruzando origen).
 *
 * Seguridad: whitelist estricta de nuestro R2_PUBLIC_URL — no es un proxy abierto.
 */

const DEFAULT_BASE = 'https://pub-9ca489d9f825495b83375f6e526f354e.r2.dev'
const TIPOS_OK = ['image/', 'audio/', 'video/', 'font/', 'application/font', 'binary/octet-stream', 'application/octet-stream']

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!esAdmin((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }

  const u = req.nextUrl.searchParams.get('u') || ''
  const base = (process.env.R2_PUBLIC_URL || DEFAULT_BASE).replace(/\/$/, '')
  if (!u.startsWith(`${base}/`)) {
    return NextResponse.json({ error: 'URL no permitida' }, { status: 400 })
  }

  try {
    const upstream = await fetch(u, { cache: 'no-store' })
    if (!upstream.ok) return NextResponse.json({ error: `upstream ${upstream.status}` }, { status: 502 })
    const ct = (upstream.headers.get('content-type') || 'application/octet-stream').toLowerCase()
    if (!TIPOS_OK.some(t => ct.startsWith(t))) {
      return NextResponse.json({ error: `tipo no permitido: ${ct}` }, { status: 400 })
    }
    const buf = await upstream.arrayBuffer()
    const cabeceras: Record<string, string> = {
      'Content-Type': ct,
      // El <audio>/<video> necesita rangos para poder buscar dentro del archivo.
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
    }
    if (req.nextUrl.searchParams.get('descargar')) {
      const nombre = (u.split('/').pop() || 'archivo').split('?')[0]
      cabeceras['Content-Disposition'] = `attachment; filename="${nombre.replace(/[^\w.-]+/g, '_')}"`
    }
    return new NextResponse(buf, { headers: cabeceras })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
