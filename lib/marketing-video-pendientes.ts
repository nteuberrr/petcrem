import { getFromR2, uploadToR2 } from './cloudflare-r2'

/**
 * Videos que el agente dejó PREPARADOS y esperan un clic del dueño.
 *
 * El MP4 se arma en el navegador (ver lib/video-marca.ts), así que el agente
 * puede dejar todo listo — guion, locución, música y fondo — pero no el archivo
 * final. Esto es esa bandeja de entrada.
 *
 * Vive en R2 como un único JSON en vez de una tabla nueva: son pocos registros,
 * efímeros (se borran al armar el video) y así no hace falta un ALTER en
 * Supabase para estrenar la función.
 */

const KEY = 'marketing/videos-pendientes/index.json'
const MAX = 30

export interface VideoPendiente {
  id: string
  creado: string
  tema: string
  titulo: string
  guion: string
  /** URL del MP3 de la locución. */
  locucion_url: string
  duracion: number
  palabras: Array<{ palabra: string; desde: number; hasta: number }>
  /** URL de la cama musical (vacío = sin música). */
  musica_url: string
  clima: string
  /** Fondo elegido del banco. */
  fondo_url: string
  fondo_tipo: 'imagen' | 'video'
  fondo_codigo: string
  fondo_grupo: string
  formato: 'reel' | 'feed'
  /** MP4 ya armado en el servidor (vacío si el render falló y hay que armarlo a mano). */
  video_url: string
  creado_por: string
}

async function leerTodos(): Promise<VideoPendiente[]> {
  try {
    const buf = await getFromR2(KEY)
    if (!buf) return []
    const j = JSON.parse(buf.toString('utf8'))
    return Array.isArray(j) ? j as VideoPendiente[] : []
  } catch { return [] }
}

async function guardarTodos(lista: VideoPendiente[]): Promise<void> {
  await uploadToR2(Buffer.from(JSON.stringify(lista.slice(0, MAX), null, 2), 'utf8'), KEY, 'application/json')
}

export async function listarPendientes(): Promise<VideoPendiente[]> {
  return leerTodos()
}

export async function agregarPendiente(v: Omit<VideoPendiente, 'id' | 'creado'>): Promise<VideoPendiente> {
  const lista = await leerTodos()
  const nuevo: VideoPendiente = { ...v, id: `v${Date.now().toString(36)}`, creado: new Date().toISOString() }
  await guardarTodos([nuevo, ...lista])
  return nuevo
}

export async function eliminarPendiente(id: string): Promise<void> {
  const lista = await leerTodos()
  await guardarTodos(lista.filter(v => v.id !== id))
}
