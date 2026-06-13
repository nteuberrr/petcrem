import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdmin } from '@/lib/roles'

/**
 * GET /api/mailing/img-proxy?u=<url>  (admin-only)
 *
 * Proxy de imágenes para los PREVIEWS de campañas. Los iframes de preview
 * cargan las imágenes a través de este endpoint (mismo origen) en vez de ir
 * directo a R2: así el preview se ve idéntico al correo aunque el navegador
 * bloquee `pub-*.r2.dev` (sandbox del iframe, extensiones/adblockers que
 * filtran r2.dev, etc.). Los correos ENVIADOS siguen usando la URL directa.
 *
 * Seguridad: solo sirve URLs bajo nuestro R2_PUBLIC_URL (whitelist estricta —
 * no es un proxy abierto) y el contenido debe ser image/*.
 */

const DEFAULT_BASE = 'https://pub-9ca489d9f825495b83375f6e526f354e.r2.dev'

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
    if (!upstream.ok) {
      return NextResponse.json({ error: `upstream ${upstream.status}` }, { status: 502 })
    }
    const ct = (upstream.headers.get('content-type') || '').toLowerCase()
    if (!ct.startsWith('image/')) {
      return NextResponse.json({ error: 'no es una imagen' }, { status: 400 })
    }
    const buf = await upstream.arrayBuffer()
    return new NextResponse(buf, {
      headers: {
        'Content-Type': ct,
        // Cache corto en el navegador: suficiente para previews sin servir versiones viejas.
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
