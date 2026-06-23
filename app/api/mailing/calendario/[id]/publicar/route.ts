import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { obtenerItem, claimPublicacion, finalizarPublicacion, marcarErrorPublicacion, type ItemCalendario } from '@/lib/marketing-calendario'
import { publicarEnCanal, isFacebookConfigurado, isInstagramConfigurado } from '@/lib/meta-publish'
import { todayISO } from '@/lib/dates'

/** Estados desde los que se puede publicar (debe haber pasado por aprobación). */
const PUBLICABLES = ['aprobada', 'generada', 'programada']

/** URLs de imagen del ítem: del carrusel (imagenes_json) o, si no, la principal. */
function urlsDeItem(item: ItemCalendario): string[] {
  try {
    if (item.imagenes_json) {
      const arr = JSON.parse(item.imagenes_json) as Array<{ url?: string }>
      const urls = Array.isArray(arr) ? arr.map(x => x?.url).filter((u): u is string => !!u) : []
      if (urls.length) return urls
    }
  } catch { /* fallback abajo */ }
  return item.imagen_url ? [item.imagen_url] : []
}

/**
 * POST /api/mailing/calendario/[id]/publicar  (admin)
 * Publica un ítem social (instagram | facebook) en la red vía Meta Graph API.
 * El email NO se publica acá: se materializa/envía desde el módulo Mailing.
 * Escribe de vuelta post_externo_id / post_url / estado en la fila.
 */
export const maxDuration = 60

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!esAdminTotal((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  const { id } = await params
  try {
    const item = await obtenerItem(id)
    if (!item) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    if (item.canal === 'email') {
      return NextResponse.json({ error: 'El email se envía desde Mailing, no se publica acá.' }, { status: 400 })
    }
    // Debe estar aprobada/generada/programada (no se publica una 'propuesta' sin revisar).
    if (!PUBLICABLES.includes(item.estado)) {
      return NextResponse.json({ error: 'Aprobá la campaña antes de publicarla.' }, { status: 400 })
    }
    // Idempotencia: si ya tiene post en la red, no republicar.
    if (item.post_externo_id) {
      return NextResponse.json({ item, post: { id: item.post_externo_id, url: item.post_url }, yaPublicado: true })
    }
    if (item.canal === 'facebook' && !isFacebookConfigurado()) {
      return NextResponse.json({ error: 'Facebook no está configurado (faltan META_GRAPH_TOKEN / META_PAGE_ID).' }, { status: 400 })
    }
    if (item.canal === 'instagram' && !isInstagramConfigurado()) {
      return NextResponse.json({ error: 'Instagram no está configurado (faltan META_GRAPH_TOKEN / META_IG_USER_ID).' }, { status: 400 })
    }
    if (!item.cuerpo?.trim()) {
      return NextResponse.json({ error: 'La pieza no tiene copy. Genérala o escríbela antes de publicar.' }, { status: 400 })
    }
    const urls = urlsDeItem(item)
    if (item.canal === 'instagram' && urls.length === 0) {
      return NextResponse.json({ error: 'Instagram requiere una imagen. Genérala o agrégala antes de publicar.' }, { status: 400 })
    }

    // Reclama el ítem de forma ATÓMICA: si otra request (doble clic, cron) ya lo
    // está publicando o lo publicó, no lo tomamos dos veces.
    const claimed = await claimPublicacion(id)
    if (!claimed) {
      return NextResponse.json({ error: 'Esta campaña ya se está publicando o ya se publicó.' }, { status: 409 })
    }
    try {
      const r = await publicarEnCanal(item.canal, { mensaje: item.cuerpo, imagenUrls: urls })
      await finalizarPublicacion(id, { postId: r.id, postUrl: r.url, fecha: todayISO() })
      const actualizado = await obtenerItem(id)
      return NextResponse.json({ item: actualizado, post: r })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await marcarErrorPublicacion(id, msg)
      return NextResponse.json({ error: `No se pudo publicar: ${msg}` }, { status: 502 })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[mailing/calendario publicar]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
