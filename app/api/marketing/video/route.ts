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
    const tomas = (Array.isArray(b.tomas) ? b.tomas : [])
      .filter((t: { url?: string }) => t && t.url)
      .map((t: { url: string; tipo?: string }) => ({ url: String(t.url), tipo: t.tipo === 'video' ? 'video' as const : 'imagen' as const }))
    if (!b.locucion_url || tomas.length === 0) {
      return NextResponse.json({ error: 'Faltan las tomas y la locución.' }, { status: 400 })
    }
    const out = await armarVideo({
      formato: b.formato === 'feed' ? 'feed' : 'reel',
      titulo: String(b.titulo || ''),
      guion: String(b.guion || ''),
      palabras: Array.isArray(b.palabras) ? b.palabras : [],
      duracion: Number(b.duracion) || 0,
      tomas,
      musicaUrl: b.musica_url ? String(b.musica_url) : undefined,
      locucionUrl: String(b.locucion_url),
      nombre: String(b.titulo || ''),
    })
    return NextResponse.json(out)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
