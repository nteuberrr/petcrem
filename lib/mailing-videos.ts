import { getSheetData, appendRow, getNextId, deleteById } from './datastore'
import { uploadToR2, deleteFromR2, keyFromPublicUrl } from './cloudflare-r2'
import { descargarVideo, VEO_MODEL } from './veo'
import { maxCodigoNum } from './mailing-images'
import { todayISO } from './dates'

/**
 * Banco de VIDEOS de campañas (tabla mailing_videos). Los MP4 viven en R2 (url/key).
 * Separado del banco de imágenes (mailing_imagenes) porque el flujo es distinto:
 * el video lo genera Veo (async) y no se normaliza a JPEG.
 */

const TABLE = 'mailing_videos'

export interface VideoBanco {
  id: string
  url: string
  key: string
  /** Código legible: ai-N (animado desde imagen) | v-N (generado sin imagen base). */
  codigo: string
  descripcion: string
  prompt: string
  /** id de la imagen del banco que se usó como primer frame (si aplica). */
  imagen_origen: string
  aspect: string
  duracion: string
  modelo: string
  favorita: boolean
  creado_por: string
  fecha_creacion: string
}

function toVideo(r: Record<string, string>): VideoBanco {
  return {
    id: r.id || '', url: r.url || '', key: r.key || '', codigo: r.codigo || '',
    descripcion: r.descripcion || '', prompt: r.prompt || '',
    imagen_origen: r.imagen_origen || '', aspect: r.aspect || '', duracion: r.duracion || '',
    modelo: r.modelo || '',
    favorita: /^(true|verdadero|1)$/i.test((r.favorita || '').trim()),
    creado_por: r.creado_por || '', fecha_creacion: r.fecha_creacion || '',
  }
}

/** Lista el banco de videos, más recientes primero. */
export async function listarVideos(): Promise<VideoBanco[]> {
  const rows = (await getSheetData(TABLE)).map(toVideo).filter(v => v.url)
  rows.sort((a, b) => (parseInt(b.id, 10) || 0) - (parseInt(a.id, 10) || 0))
  return rows
}

/** Elimina un video (de la tabla y best-effort de R2). */
export async function eliminarVideo(id: string): Promise<void> {
  const rows = await getSheetData(TABLE)
  const row = rows.find(r => String(r.id) === String(id))
  if (row) {
    const k = row.key || keyFromPublicUrl(row.url || '') || ''
    if (k) { try { await deleteFromR2(k) } catch { /* best-effort */ } }
  }
  await deleteById(TABLE, id)
}

/**
 * Descarga el video ya terminado (por su uri de Veo), lo sube a R2 y lo registra
 * en el banco. Devuelve la fila creada. Lo llama el endpoint cuando la operación
 * quedó `done` (una sola vez, desde el cliente).
 */
export async function guardarVideo(args: {
  uri: string
  prompt: string
  descripcion?: string
  imagenOrigen?: string
  aspect?: string
  duracion?: string
  creadoPor?: string
}): Promise<VideoBanco> {
  const { buffer, mime } = await descargarVideo(args.uri)
  const ext = mime.includes('webm') ? 'webm' : 'mp4'
  const key = `mailing/videos/${Date.now()}.${ext}`
  const up = await uploadToR2(buffer, key, mime)
  const id = await getNextId(TABLE)
  // Código: ai-N si se animó desde una imagen del banco; v-N si fue text-to-video.
  const codigos = (await getSheetData(TABLE)).map(r => r.codigo || '')
  const prefijo = args.imagenOrigen ? 'ai' : 'v'
  const codigo = `${prefijo}-${maxCodigoNum(codigos, prefijo) + 1}`
  const row: Record<string, string> = {
    id,
    url: up.url,
    key: up.key,
    codigo,
    descripcion: (args.descripcion || args.prompt || '').slice(0, 200),
    prompt: args.prompt || '',
    imagen_origen: args.imagenOrigen || '',
    aspect: args.aspect || '',
    duracion: args.duracion || '',
    modelo: VEO_MODEL,
    favorita: 'FALSE',
    creado_por: args.creadoPor || '',
    fecha_creacion: todayISO(),
  }
  await appendRow(TABLE, row)
  return toVideo(row)
}
