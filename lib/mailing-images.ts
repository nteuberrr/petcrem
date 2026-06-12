import { getSheetData, appendRow, getNextId, deleteById, updateById } from './datastore'
import { uploadToR2, deleteFromR2, keyFromPublicUrl } from './cloudflare-r2'
import { generarImagen, extFromMime } from './nano-banana'
import { todayISO } from './dates'

/** Grupos válidos para clasificar imágenes del banco. */
export const GRUPOS_IMAGEN = ['mascotas', 'personas', 'productos', 'instalaciones', 'otro'] as const
export type GrupoImagen = typeof GRUPOS_IMAGEN[number]

/**
 * Banco de imágenes de campañas (tabla mailing_imagenes). Las imágenes viven en
 * R2 y se RECICLAN entre correos: el generador IA consulta este banco y reutiliza
 * una imagen existente cuando calza con el contexto, en vez de generar otra nueva.
 * `descripcion` + `tags` son lo que alimenta ese match.
 */

const TABLE = 'mailing_imagenes'

export interface ImagenBanco {
  id: string
  url: string
  key: string
  descripcion: string
  prompt: string
  tags: string
  alt: string
  grupo: string
  aspect: string
  ancho: string
  alto: string
  origen: string // 'ai' | 'upload'
  modelo: string
  creado_por: string
  fecha_creacion: string
}

function toImagen(r: Record<string, string>): ImagenBanco {
  return {
    id: r.id || '', url: r.url || '', key: r.key || '',
    descripcion: r.descripcion || '', prompt: r.prompt || '', tags: r.tags || '', alt: r.alt || '',
    grupo: r.grupo || '',
    aspect: r.aspect || '', ancho: r.ancho || '', alto: r.alto || '',
    origen: r.origen || '', modelo: r.modelo || '',
    creado_por: r.creado_por || '', fecha_creacion: r.fecha_creacion || '',
  }
}

/** Lista el banco, más recientes primero. */
export async function listarImagenes(): Promise<ImagenBanco[]> {
  const rows = await getSheetData(TABLE)
  const imgs = rows.map(toImagen).filter(i => i.url)
  imgs.sort((a, b) => (parseInt(b.id, 10) || 0) - (parseInt(a.id, 10) || 0))
  return imgs
}

export interface RegistrarImagenInput {
  url: string
  key: string
  descripcion?: string
  prompt?: string
  tags?: string
  alt?: string
  grupo?: string
  aspect?: string
  ancho?: number | string
  alto?: number | string
  origen?: string
  modelo?: string
  creadoPor?: string
}

/** Registra una imagen ya subida a R2 en el banco. Devuelve la fila creada. */
export async function registrarImagen(input: RegistrarImagenInput): Promise<ImagenBanco> {
  const id = await getNextId(TABLE)
  const row: Record<string, string> = {
    id,
    url: input.url,
    key: input.key,
    descripcion: (input.descripcion || '').trim(),
    prompt: (input.prompt || '').trim(),
    tags: (input.tags || '').trim(),
    alt: (input.alt || '').trim(),
    grupo: (input.grupo || '').trim(),
    aspect: (input.aspect || '').trim(),
    ancho: input.ancho != null ? String(input.ancho) : '',
    alto: input.alto != null ? String(input.alto) : '',
    origen: input.origen || 'ai',
    modelo: input.modelo || '',
    creado_por: input.creadoPor || '',
    fecha_creacion: todayISO(),
  }
  await appendRow(TABLE, row)
  return toImagen(row)
}

export interface ImagenGeneradaResult {
  imagen: ImagenBanco
  /** Bytes de la imagen recién generada — para el pase de revisión con visión. */
  buffer: Buffer
  mime: string
}

/**
 * Genera una imagen con Nano Banana Pro, la sube a R2 y la registra en el banco.
 * Devuelve la fila del banco + los bytes (para revisarla con visión antes de entregar).
 */
export async function generarYGuardarImagen(args: {
  prompt: string
  alt?: string
  descripcion?: string
  tags?: string
  grupo?: string
  aspect?: string
  creadoPor?: string
  referencias?: { data: Buffer; mime: string }[]
}): Promise<ImagenGeneradaResult> {
  const img = await generarImagen({ prompt: args.prompt, aspect: args.aspect, referencias: args.referencias })
  const ext = extFromMime(img.mime)
  const ts = Date.now()
  const key = `mailing/ai-images/${ts}.${ext}`
  const up = await uploadToR2(img.buffer, key, img.mime)
  const imagen = await registrarImagen({
    url: up.url,
    key: up.key,
    descripcion: args.descripcion || args.alt || '',
    prompt: args.prompt,
    tags: args.tags || '',
    alt: args.alt || args.descripcion || '',
    grupo: args.grupo || '',
    aspect: args.aspect || '',
    origen: 'ai',
    modelo: img.modelo,
    creadoPor: args.creadoPor,
  })
  return { imagen, buffer: img.buffer, mime: img.mime }
}

/**
 * Reasigna el grupo (y opcionalmente descripción/tags) de una imagen del banco.
 * Lee la fila y la reescribe COMPLETA (updateById sobreescribe toda la fila, así
 * que hay que mergear para no borrar las demás columnas).
 */
export async function actualizarImagen(
  id: string,
  cambios: { grupo?: string; descripcion?: string; tags?: string },
): Promise<void> {
  const rows = await getSheetData(TABLE)
  const row = rows.find(r => String(r.id) === String(id))
  if (!row) throw new Error(`imagen ${id} no encontrada`)
  const merged = { ...row }
  if (cambios.grupo !== undefined) merged.grupo = cambios.grupo.trim()
  if (cambios.descripcion !== undefined) merged.descripcion = cambios.descripcion.trim()
  if (cambios.tags !== undefined) merged.tags = cambios.tags.trim()
  await updateById(TABLE, id, merged)
}

/** Elimina una imagen del banco (y best-effort de R2). */
export async function eliminarImagen(id: string): Promise<void> {
  const rows = await getSheetData(TABLE)
  const row = rows.find(r => String(r.id) === String(id))
  if (row) {
    const key = row.key || keyFromPublicUrl(row.url || '') || ''
    if (key) { try { await deleteFromR2(key) } catch { /* best-effort */ } }
  }
  await deleteById(TABLE, id)
}
