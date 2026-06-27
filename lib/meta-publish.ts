/**
 * Publicación orgánica en Facebook Pages e Instagram vía Meta Graph API.
 *
 * Reutiliza la MISMA app de Meta que WhatsApp. Publicar en las cuentas PROPIAS
 * del negocio (la Página y el IG Business dentro del mismo Business) corre bajo
 * Standard Access: NO requiere App Review ni Business Verification, y la API es
 * gratis. (El App Review sí haría falta para responder DMs de terceros — eso es
 * otro flujo, ver el módulo Mensajes.)
 *
 * Credenciales (.env.local):
 *   META_GRAPH_TOKEN   System User token con scopes pages_manage_posts,
 *                      pages_read_engagement, instagram_basic, instagram_content_publish.
 *   META_PAGE_ID       ID de la Página de Facebook.
 *   META_IG_USER_ID    ID de la cuenta de Instagram Business vinculada.
 *   META_API_VERSION   (opcional) default v22.0.
 */

const API = process.env.META_API_VERSION || process.env.WHATSAPP_API_VERSION || 'v22.0'
const BASE = `https://graph.facebook.com/${API}`

function token(): string {
  return process.env.META_GRAPH_TOKEN || process.env.WHATSAPP_TOKEN || ''
}
function pageId(): string {
  return process.env.META_PAGE_ID || ''
}
function igUserId(): string {
  return process.env.META_IG_USER_ID || ''
}

/** ¿Hay token + Página configurados para publicar en Facebook? */
export function isFacebookConfigurado(): boolean {
  return !!token() && !!pageId()
}
/** ¿Hay token + cuenta IG configurados para publicar en Instagram? */
export function isInstagramConfigurado(): boolean {
  return !!token() && !!igUserId()
}
export function isMetaPublishConfigurado(): boolean {
  return isFacebookConfigurado() || isInstagramConfigurado()
}

export interface ResultadoPublicacion {
  /** ID del post/medio en la red. */
  id: string
  /** URL pública del post (si la red la devuelve). */
  url: string
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

async function graph(path: string, params: Record<string, string>, method: 'GET' | 'POST' = 'GET'): Promise<Record<string, unknown>> {
  const url = `${BASE}/${path}`
  let res: Response
  if (method === 'POST') {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) })
  } else {
    const qs = new URLSearchParams(params).toString()
    res = await fetch(`${url}?${qs}`)
  }
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) {
    // Meta devuelve code/error_subcode/error_user_msg, que explican el fallo real
    // (190 token vencido, 4/17/32/613 rate limit, 100/subcode formato, 200 permisos).
    const e = data?.error as { message?: string; code?: number; error_subcode?: number; error_user_msg?: string } | undefined
    const base = e?.error_user_msg || e?.message || `HTTP ${res.status}`
    const cod = e?.code != null ? ` [code ${e.code}${e.error_subcode != null ? '/' + e.error_subcode : ''}]` : ''
    console.error('[meta-publish] Graph error:', JSON.stringify(e || data))
    throw new Error(`${base}${cod}`)
  }
  return data
}

// El token de System User no siempre sirve directo para /{page}/feed; lo más
// robusto es derivar el Page Access Token de la Página y usar ese. Cacheado.
let pageTokenCache: { id: string; token: string } | null = null
export async function getPageToken(): Promise<string> {
  const pid = pageId()
  if (pageTokenCache && pageTokenCache.id === pid) return pageTokenCache.token
  const data = await graph(pid, { fields: 'access_token', access_token: token() })
  const pt = data.access_token as string | undefined
  // No hacer fallback silencioso al token de usuario: /feed,/photos,/media exigen
  // un Page token; si no vino, es config (System User sin rol/scopes sobre la Página).
  if (!pt) {
    throw new Error('No se pudo obtener el Page Access Token de la Página. Verificá que META_GRAPH_TOKEN sea de un System User con rol sobre META_PAGE_ID y con los scopes pages_manage_posts / pages_read_engagement.')
  }
  pageTokenCache = { id: pid, token: pt }
  return pt
}

/** Lee los campos del perfil de la Página de Facebook (para auditar/optimizar). */
export async function leerPerfilFacebook(): Promise<Record<string, unknown> | null> {
  if (!isFacebookConfigurado()) return null
  const pt = await getPageToken()
  const fields = 'name,about,description,category,phone,emails,website,link,fan_count,followers_count'
  return graph(pageId(), { fields, access_token: pt })
}

/** Lee los campos del perfil de Instagram (null si el IG aún no está conectado). */
export async function leerPerfilInstagram(): Promise<Record<string, unknown> | null> {
  if (!isInstagramConfigurado()) return null
  const pt = await getPageToken()
  const fields = 'username,name,biography,website,followers_count,follows_count,media_count,profile_picture_url'
  return graph(igUserId(), { fields, access_token: pt })
}

/**
 * Actualiza campos de TEXTO de la Página de Facebook (la API de IG no permite
 * editar el perfil; la de Páginas sí estos campos). Requiere pages_manage_metadata.
 */
export async function actualizarPerfilFacebook(campos: Record<string, string>): Promise<void> {
  if (!isFacebookConfigurado()) throw new Error('Facebook no configurado')
  const permitidos = ['about', 'description', 'phone', 'website', 'emails']
  const params: Record<string, string> = { access_token: await getPageToken() }
  for (const [k, v] of Object.entries(campos)) if (permitidos.includes(k)) params[k] = v
  if (Object.keys(params).length <= 1) throw new Error('No hay campos válidos para actualizar')
  await graph(pageId(), params, 'POST')
}

/**
 * Devuelve el permalink REAL del post (URL clickeable). En la "New Pages Experience"
 * la URL pública NO es facebook.com/{pageId}_{postId} (eso no abre), sino el
 * permalink_url que entrega la propia API. Best-effort: si no se puede leer, '' .
 */
async function permalinkDe(idPost: string, pt: string): Promise<string> {
  if (!idPost) return ''
  try {
    const d = await graph(idPost, { fields: 'permalink_url', access_token: pt })
    return (d.permalink_url as string) || ''
  } catch { return '' }
}

/**
 * Publica en la Página de Facebook. Si hay imagen, sube una foto con caption;
 * si no, un post de texto (con link opcional). Devuelve el permalink REAL.
 */
export async function publicarFacebook(args: { mensaje: string; imagenUrl?: string; link?: string }): Promise<ResultadoPublicacion> {
  if (!isFacebookConfigurado()) throw new Error('Facebook no configurado (faltan META_GRAPH_TOKEN o META_PAGE_ID)')
  const pt = await getPageToken()
  const pid = pageId()
  if (args.imagenUrl) {
    const data = await graph(`${pid}/photos`, {
      url: args.imagenUrl,
      caption: args.mensaje || '',
      access_token: pt,
    }, 'POST')
    const postId = (data.post_id as string) || (data.id as string) || ''
    const url = await permalinkDe(postId, pt)
    return { id: postId, url: url || (postId ? `https://www.facebook.com/${postId}` : '') }
  }
  const params: Record<string, string> = { message: args.mensaje || '', access_token: pt }
  if (args.link) params.link = args.link
  const data = await graph(`${pid}/feed`, params, 'POST')
  const postId = (data.id as string) || ''
  const url = await permalinkDe(postId, pt)
  return { id: postId, url: url || (postId ? `https://www.facebook.com/${postId}` : '') }
}

/** Espera a que un contenedor quede FINISHED, lo publica y devuelve {id, url}. */
async function publicarContenedor(ig: string, pt: string, creationId: string): Promise<ResultadoPublicacion> {
  // Las fotos suelen procesarse al instante; los carruseles tardan algo más.
  // Esperamos FINISHED de verdad: si tras los intentos sigue procesando, NO
  // llamamos media_publish (devolvería un error críptico de Meta).
  let listo = false
  for (let i = 0; i < 18; i++) {
    const st = await graph(creationId, { fields: 'status_code,status', access_token: pt })
    const code = (st.status_code as string) || ''
    if (code === 'FINISHED') { listo = true; break }
    if (code === 'ERROR' || code === 'EXPIRED') {
      const detalle = (st.status as string) || code
      throw new Error(`Instagram no pudo procesar el contenido (${detalle}). Revisá que las imágenes sean JPEG públicas.`)
    }
    await sleep(2500)
  }
  if (!listo) throw new Error('Instagram no terminó de procesar el contenido a tiempo. Probá de nuevo en unos minutos.')
  const pub = await graph(`${ig}/media_publish`, { creation_id: creationId, access_token: pt }, 'POST')
  const mediaId = (pub.id as string) || ''
  if (!mediaId) throw new Error('Instagram no devolvió el medio publicado')
  let url = ''
  try {
    const link = await graph(mediaId, { fields: 'permalink', access_token: pt })
    url = (link.permalink as string) || ''
  } catch { /* best-effort */ }
  return { id: mediaId, url }
}

/**
 * Publica en Instagram (flujo basado en contenedores). 1 imagen = post simple;
 * 2 a 10 = CARRUSEL. Las imágenes deben ser URLs públicas JPEG (la API de IG no
 * acepta PNG/WebP). En carrusel, Instagram recorta todas según la primera.
 */
export async function publicarInstagram(args: { caption: string; imagenUrls: string[] }): Promise<ResultadoPublicacion> {
  if (!isInstagramConfigurado()) throw new Error('Instagram no configurado (faltan META_GRAPH_TOKEN o META_IG_USER_ID)')
  const urls = (args.imagenUrls || []).filter(Boolean).slice(0, 10)
  if (urls.length === 0) throw new Error('Instagram requiere al menos una imagen (URL pública JPEG)')
  // IG solo acepta JPEG. Las imágenes generadas por IA ya se normalizan a JPEG;
  // este chequeo atrapa imágenes del banco/manuales en PNG/WebP con un mensaje claro.
  const noJpeg = urls.filter(u => !/\.jpe?g(\?|$)/i.test(u))
  if (noJpeg.length > 0) {
    throw new Error('Instagram solo acepta imágenes JPEG. Hay imágenes en otro formato (PNG/WebP). Regenerá la imagen con IA (se guarda como JPEG) o subí una JPEG al banco.')
  }
  const pt = await getPageToken()
  const ig = igUserId()

  // POST simple (1 imagen)
  if (urls.length === 1) {
    const cont = await graph(`${ig}/media`, { image_url: urls[0], caption: args.caption || '', access_token: pt }, 'POST')
    const creationId = (cont.id as string) || ''
    if (!creationId) throw new Error('Instagram no devolvió el contenedor')
    return publicarContenedor(ig, pt, creationId)
  }

  // CARRUSEL (2 a 10): un contenedor hijo por imagen + un contenedor CAROUSEL.
  const childrenIds: string[] = []
  for (const u of urls) {
    const child = await graph(`${ig}/media`, { image_url: u, is_carousel_item: 'true', access_token: pt }, 'POST')
    const cid = (child.id as string) || ''
    if (!cid) throw new Error('Instagram no devolvió un contenedor hijo del carrusel')
    childrenIds.push(cid)
  }
  const carrusel = await graph(`${ig}/media`, {
    media_type: 'CAROUSEL',
    children: childrenIds.join(','), // form-encoded → lista separada por comas
    caption: args.caption || '',
    access_token: pt,
  }, 'POST')
  const creationId = (carrusel.id as string) || ''
  if (!creationId) throw new Error('Instagram no devolvió el contenedor del carrusel')
  return publicarContenedor(ig, pt, creationId)
}

/** Publica en el canal indicado. `imagenUrls` permite carrusel en Instagram. */
export async function publicarEnCanal(
  canal: string,
  args: { mensaje: string; imagenUrl?: string; imagenUrls?: string[]; link?: string },
): Promise<ResultadoPublicacion> {
  const urls = (args.imagenUrls && args.imagenUrls.length ? args.imagenUrls : (args.imagenUrl ? [args.imagenUrl] : [])).filter(Boolean)
  if (canal === 'facebook') return publicarFacebook({ mensaje: args.mensaje, imagenUrl: urls[0], link: args.link })
  if (canal === 'instagram') {
    if (urls.length === 0) throw new Error('Instagram requiere al menos una imagen para publicar')
    return publicarInstagram({ caption: args.mensaje, imagenUrls: urls })
  }
  throw new Error(`Canal no publicable por API: ${canal}`)
}
