import { obtenerItem, claimPublicacion, finalizarPublicacion, marcarErrorPublicacion, type ItemCalendario } from './marketing-calendario'
import { publicarEnCanal, isFacebookConfigurado, isInstagramConfigurado } from './meta-publish'
import { todayISO } from './dates'

/**
 * Publicación de una pieza del calendario en la red social (Instagram | Facebook),
 * compartida por el endpoint manual (/api/mailing/calendario/[id]/publicar) y por
 * la herramienta del agente de marketing. Centraliza las validaciones, la
 * idempotencia y el "claim" atómico anti doble-publicación, así el agente publica
 * con exactamente las mismas garantías que el botón.
 */

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

export interface PublicarResult {
  item: ItemCalendario | null
  post?: { id: string; url: string }
  yaPublicado?: boolean
}

/**
 * Publica el ítem `id`. Lanza Error (con mensaje claro) si no se puede; el caller
 * decide cómo mostrarlo. Idempotente: si ya tiene post, lo devuelve sin republicar.
 */
export async function publicarItem(id: string): Promise<PublicarResult> {
  const item = await obtenerItem(id)
  if (!item) throw new Error('Campaña no encontrada.')
  if (item.canal === 'email') throw new Error('El email se envía desde Mailing, no se publica acá.')
  if (!PUBLICABLES.includes(item.estado)) throw new Error('Aprobá la campaña antes de publicarla.')
  // Idempotencia: si ya tiene post en la red, no republicar.
  if (item.post_externo_id) return { item, post: { id: item.post_externo_id, url: item.post_url }, yaPublicado: true }
  if (item.canal === 'facebook' && !isFacebookConfigurado()) throw new Error('Facebook no está configurado (faltan META_GRAPH_TOKEN / META_PAGE_ID).')
  if (item.canal === 'instagram' && !isInstagramConfigurado()) throw new Error('Instagram no está configurado (faltan META_GRAPH_TOKEN / META_IG_USER_ID).')
  if (!item.cuerpo?.trim()) throw new Error('La pieza no tiene copy. Generala o escribila antes de publicar.')
  const urls = urlsDeItem(item)
  if (item.canal === 'instagram' && urls.length === 0) throw new Error('Instagram requiere una imagen. Generala o agregala antes de publicar.')

  // Reclamo ATÓMICO: si otra request (doble clic, cron) ya lo está publicando, no lo tomamos dos veces.
  const claimed = await claimPublicacion(id)
  if (!claimed) throw new Error('Esta campaña ya se está publicando o ya se publicó.')
  try {
    const r = await publicarEnCanal(item.canal, { mensaje: item.cuerpo, imagenUrls: urls })
    await finalizarPublicacion(id, { postId: r.id, postUrl: r.url, fecha: todayISO() })
    const actualizado = await obtenerItem(id)
    return { item: actualizado, post: r }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await marcarErrorPublicacion(id, msg)
    throw new Error(`No se pudo publicar: ${msg}`)
  }
}
