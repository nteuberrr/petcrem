import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdmin } from '@/lib/roles'
import { armarVideo } from '@/lib/marketing-video-armar'

/**
 * Arma el MP4 en el SERVIDOR y lo deja en R2. Es el camino por defecto del
 * panel: el navegador solo queda de respaldo si esto falla.
 *
 * Codificar ~30 s de 1080×1920 tarda del orden de un minuto, de ahí el margen.
 */
export const maxDuration = 300
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!esAdmin((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  try {
    const b = await req.json().catch(() => ({}))
    if (!b.locucion_url || !b.fondo_url) {
      return NextResponse.json({ error: 'Faltan el fondo y la locución.' }, { status: 400 })
    }
    const out = await armarVideo({
      formato: b.formato === 'feed' ? 'feed' : 'reel',
      titulo: String(b.titulo || ''),
      guion: String(b.guion || ''),
      palabras: Array.isArray(b.palabras) ? b.palabras : [],
      duracion: Number(b.duracion) || 0,
      fondoUrl: String(b.fondo_url),
      fondoTipo: b.fondo_tipo === 'video' ? 'video' : 'imagen',
      musicaUrl: b.musica_url ? String(b.musica_url) : undefined,
      locucionUrl: String(b.locucion_url),
      nombre: String(b.titulo || ''),
    })
    return NextResponse.json(out)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
