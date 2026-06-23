import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { listarCalendario, claimPublicacion, finalizarPublicacion, marcarErrorPublicacion, type ItemCalendario } from '@/lib/marketing-calendario'
import { publicarEnCanal, isFacebookConfigurado, isInstagramConfigurado } from '@/lib/meta-publish'
import { todayISO } from '@/lib/dates'

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
 * /api/mailing/cron-publicar  (ruta pública en proxy; auth interna)
 *
 * Publica en FB/IG los ítems sociales APROBADOS o PROGRAMADOS cuya fecha ya llegó
 * y que aún no se publicaron. Pensada para Vercel Cron (Bearer CRON_SECRET); también
 * la puede disparar un admin con sesión (botón "Publicar pendientes").
 *
 * Fail-closed: si CRON_SECRET no está seteado, solo un admin con sesión puede correrla.
 */
export const maxDuration = 300

async function autorizado(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') || ''
    if (auth === `Bearer ${secret}`) return true
  }
  const session = await getServerSession(authOptions)
  return esAdminTotal((session?.user as { role?: string })?.role)
}

async function ejecutar(req: NextRequest) {
  if (!(await autorizado(req))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  const hoy = todayISO()
  const todos = await listarCalendario()
  // Solo publica lo que el equipo PROGRAMÓ explícitamente (estado 'programada').
  // 'aprobada' NO se autopublica — eso lo hace el admin a mano ("nada se publica solo").
  // Excluye lo ya publicado, lo que ya está en vuelo, y lo que ya tiene post en la red.
  const pendientes = todos.filter(it =>
    (it.canal === 'instagram' || it.canal === 'facebook') &&
    it.estado === 'programada' &&
    it.estado_publicacion !== 'publicado' &&
    it.estado_publicacion !== 'publicando' &&
    !it.post_externo_id &&
    it.cuerpo?.trim() &&
    it.fecha && it.fecha <= hoy
  )

  const resultados: Array<{ id: string; canal: string; ok: boolean; error?: string; url?: string }> = []
  for (const it of pendientes) {
    if (it.canal === 'facebook' && !isFacebookConfigurado()) { resultados.push({ id: it.id, canal: it.canal, ok: false, error: 'Facebook no configurado' }); continue }
    if (it.canal === 'instagram' && (!isInstagramConfigurado() || urlsDeItem(it).length === 0)) { resultados.push({ id: it.id, canal: it.canal, ok: false, error: 'Instagram sin config o sin imagen' }); continue }
    // Reclamo atómico: si otro proceso (o el botón manual) ya lo tomó, lo salteamos.
    const claimed = await claimPublicacion(it.id)
    if (!claimed) { resultados.push({ id: it.id, canal: it.canal, ok: false, error: 'ya en publicación' }); continue }
    try {
      const r = await publicarEnCanal(it.canal, { mensaje: it.cuerpo, imagenUrls: urlsDeItem(it) })
      await finalizarPublicacion(it.id, { postId: r.id, postUrl: r.url, fecha: hoy })
      resultados.push({ id: it.id, canal: it.canal, ok: true, url: r.url })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await marcarErrorPublicacion(it.id, msg)
      resultados.push({ id: it.id, canal: it.canal, ok: false, error: msg })
    }
  }
  return NextResponse.json({ revisados: pendientes.length, publicados: resultados.filter(r => r.ok).length, resultados })
}

export async function GET(req: NextRequest) { return ejecutar(req) }
export async function POST(req: NextRequest) { return ejecutar(req) }
