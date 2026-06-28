import sharp from 'sharp'
import { getSheetData, appendRow, getNextId, deleteById, updateById, ensureSheet, ensureColumns } from './datastore'
import { uploadToR2, deleteFromR2, keyFromPublicUrl, getFromR2 } from './cloudflare-r2'
import { generarImagen, extFromMime } from './nano-banana'
import { aplicarLogoMarca } from './marca-logo'
import { nextContador } from './banco-contadores'
import { todayISO } from './dates'

/** Grupos válidos para clasificar imágenes del banco. */
export const GRUPOS_IMAGEN = ['marca', 'mascotas', 'personas', 'productos', 'instalaciones', 'otro'] as const
export type GrupoImagen = typeof GRUPOS_IMAGEN[number]

/**
 * Banco de imágenes de campañas (tabla mailing_imagenes). Las imágenes viven en
 * R2 y se RECICLAN entre correos: el generador IA consulta este banco y reutiliza
 * una imagen existente cuando calza con el contexto, en vez de generar otra nueva.
 * `descripcion` + `tags` son lo que alimenta ese match.
 */

const TABLE = 'mailing_imagenes'
const COLS = [
  'id', 'url', 'key', 'codigo', 'descripcion', 'prompt', 'tags', 'alt', 'grupo', 'subgrupo', 'whatsapp', 'favorita',
  'aspect', 'ancho', 'alto', 'origen', 'modelo', 'creado_por', 'fecha_creacion',
]

/** Garantiza que la tabla y sus columnas existan (no-op en Postgres). */
async function ensureBanco(): Promise<void> {
  await ensureSheet(TABLE)
  await ensureColumns(TABLE, COLS)
}

export interface ImagenBanco {
  id: string
  url: string
  key: string
  /** Código legible y estable: i-N (foto suelta/subida) | C-X.Y (pieza de campaña). */
  codigo: string
  descripcion: string
  prompt: string
  tags: string
  alt: string
  grupo: string
  /** Etiqueta libre opcional para ordenar dentro de un grupo (ej. por campaña). */
  subgrupo: string
  /** El agente de WhatsApp puede enviar esta imagen al cliente cuando la pida. */
  whatsapp: boolean
  /** Destacada con la estrella en el banco. */
  favorita: boolean
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
    id: r.id || '', url: r.url || '', key: r.key || '', codigo: r.codigo || '',
    descripcion: r.descripcion || '', prompt: r.prompt || '', tags: r.tags || '', alt: r.alt || '',
    grupo: r.grupo || '',
    subgrupo: r.subgrupo || '',
    whatsapp: /^(true|verdadero|1)$/i.test((r.whatsapp || '').trim()),
    favorita: /^(true|verdadero|1)$/i.test((r.favorita || '').trim()),
    aspect: r.aspect || '', ancho: r.ancho || '', alto: r.alto || '',
    origen: r.origen || '', modelo: r.modelo || '',
    creado_por: r.creado_por || '', fecha_creacion: r.fecha_creacion || '',
  }
}

// ─── Códigos legibles (i-N / C-X.Y) ──────────────────────────────────────────
// MONOTÓNICOS: el número lo entrega nextContador() (tabla banco_contadores, atómico),
// que guarda el high-water mark y NUNCA reutiliza un número aunque se borre la imagen.
// maxCodigoNum/maxCampaniaNum se siguen usando solo para auto-sincronizar el contador
// (p_min) con el máximo real de los datos por si quedó atrás.

const reNum = (p: string) => new RegExp(`^${p}-(\\d+)$`)

/** Mayor N usado para un prefijo simple (i, v, ai) entre los códigos dados. */
export function maxCodigoNum(codigos: string[], prefijo: string): number {
  const re = reNum(prefijo)
  let max = 0
  for (const c of codigos) { const m = re.exec((c || '').trim()); if (m) max = Math.max(max, parseInt(m[1], 10) || 0) }
  return max
}

/** Mayor número de campaña (C-X) entre los códigos dados (mira C-X.Y). */
export function maxCampaniaNum(codigos: string[]): number {
  let max = 0
  for (const c of codigos) { const m = /^C-(\d+)\./.exec((c || '').trim()); if (m) max = Math.max(max, parseInt(m[1], 10) || 0) }
  return max
}

/** Códigos ya usados en el banco de imágenes. */
async function codigosImagenes(): Promise<string[]> {
  return (await getSheetData(TABLE)).map(r => r.codigo || '')
}

/**
 * Reserva un código de campaña nuevo (C-X) para agrupar varias imágenes (un
 * carrusel/collage). El caller registra cada imagen pasándolo como `campania` →
 * quedan C-X.1, C-X.2, … Llamar UNA vez por campaña, antes del lote.
 */
export async function asignarCampania(): Promise<string> {
  const x = await nextContador('img:C', maxCampaniaNum(await codigosImagenes()))
  return `C-${x}`
}

/** Calcula el código MONOTÓNICO a usar para una imagen nueva según kind/campania. */
async function calcularCodigo(codigos: string[], opts: { kind?: 'foto' | 'publicacion'; campania?: string }): Promise<string> {
  if (opts.campania) {
    // Imagen dentro de una campaña ya reservada → siguiente índice .Y (contador por campaña).
    const re = new RegExp(`^${opts.campania.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(\\d+)$`)
    let maxY = 0
    for (const c of codigos) { const m = re.exec((c || '').trim()); if (m) maxY = Math.max(maxY, parseInt(m[1], 10) || 0) }
    const y = await nextContador(`img:${opts.campania}`, maxY)
    return `${opts.campania}.${y}`
  }
  if (opts.kind === 'publicacion') {
    // Pieza suelta que abre su propia campaña → C-X.1 (X y Y, ambos monotónicos).
    const x = await nextContador('img:C', maxCampaniaNum(codigos))
    const y = await nextContador(`img:C-${x}`, 0)
    return `C-${x}.${y}`
  }
  const n = await nextContador('img:i', maxCodigoNum(codigos, 'i'))
  return `i-${n}`
}

/** Lista el banco, más recientes primero. */
export async function listarImagenes(): Promise<ImagenBanco[]> {
  const rows = await getSheetData(TABLE)
  const imgs = rows.map(toImagen).filter(i => i.url)
  imgs.sort((a, b) => (parseInt(b.id, 10) || 0) - (parseInt(a.id, 10) || 0))
  return imgs
}

/** Imágenes que el agente de WhatsApp puede enviar al cliente (whatsapp = TRUE). */
export async function listarImagenesWhatsapp(): Promise<ImagenBanco[]> {
  return (await listarImagenes()).filter(i => i.whatsapp && i.url)
}

export interface RegistrarImagenInput {
  url: string
  key: string
  descripcion?: string
  prompt?: string
  tags?: string
  alt?: string
  grupo?: string
  subgrupo?: string
  whatsapp?: boolean
  favorita?: boolean
  aspect?: string
  ancho?: number | string
  alto?: number | string
  origen?: string
  modelo?: string
  creadoPor?: string
  /** Código explícito (ej. backfill). Si se omite, se calcula por kind/campania. */
  codigo?: string
  /** Tipo para el código auto: 'foto' (i-N, default) o 'publicacion' (C-X.1). */
  kind?: 'foto' | 'publicacion'
  /** Campaña ya reservada con asignarCampania() → la imagen queda como C-X.Y. */
  campania?: string
}

/** Registra una imagen ya subida a R2 en el banco. Devuelve la fila creada. */
export async function registrarImagen(input: RegistrarImagenInput): Promise<ImagenBanco> {
  await ensureBanco()
  const id = await getNextId(TABLE)
  const codigo = (input.codigo || '').trim() || (await calcularCodigo(await codigosImagenes(), { kind: input.kind, campania: input.campania }))
  const row: Record<string, string> = {
    id,
    url: input.url,
    key: input.key,
    codigo,
    descripcion: (input.descripcion || '').trim(),
    prompt: (input.prompt || '').trim(),
    tags: (input.tags || '').trim(),
    alt: (input.alt || '').trim(),
    grupo: (input.grupo || '').trim(),
    subgrupo: (input.subgrupo || '').trim(),
    whatsapp: input.whatsapp ? 'TRUE' : 'FALSE',
    favorita: input.favorita ? 'TRUE' : 'FALSE',
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
  /** Bytes de la imagen (limpia, sin logo) — para revisión con visión o referencia de carrusel. */
  buffer: Buffer
  mime: string
}

/**
 * Genera una imagen con Nano Banana Pro, la sube a R2 y la registra en el banco.
 * Las imágenes del banco quedan SIEMPRE LIMPIAS (sin logo): el logo es un paso de
 * cierre que se aplica a la pieza que se publica (ver estamparLogoEnUrl), así una
 * misma imagen se puede reutilizar sin arrastrar el logo y no se duplica.
 */
export async function generarYGuardarImagen(args: {
  prompt: string
  alt?: string
  descripcion?: string
  tags?: string
  grupo?: string
  subgrupo?: string
  aspect?: string
  creadoPor?: string
  referencias?: { data: Buffer; mime: string }[]
  /** Edición image-to-image: preserva la 1ª referencia y cambia solo lo pedido. */
  editar?: boolean
  /** Modo gráfico: la pieza lleva texto integrado (portada, placa con datos, anuncio). */
  conTexto?: boolean
  /** Código: 'foto' (i-N, default) o 'publicacion' (C-X.1). */
  kind?: 'foto' | 'publicacion'
  /** Campaña reservada (asignarCampania) → la imagen queda C-X.Y. */
  campania?: string
}): Promise<ImagenGeneradaResult> {
  const img = await generarImagen({ prompt: args.prompt, aspect: args.aspect, referencias: args.referencias, editar: args.editar, conTexto: args.conTexto })

  // Normaliza a JPEG: Instagram (Content Publishing API) SOLO acepta JPEG, y el
  // generador suele devolver PNG. Convertir acá deja toda imagen generada lista
  // para publicar en IG/FB y más liviana. Si la conversión falla, sube el original.
  let buffer = img.buffer
  let mime = img.mime
  if (mime !== 'image/jpeg') {
    try {
      buffer = await sharp(buffer).flatten({ background: '#ffffff' }).jpeg({ quality: 88 }).toBuffer()
      mime = 'image/jpeg'
    } catch (e) {
      console.warn('[mailing-images] no se pudo convertir a JPEG, se sube el original:', e)
    }
  }

  const ext = extFromMime(mime)
  const key = `mailing/ai-images/${Date.now()}.${ext}`
  const up = await uploadToR2(buffer, key, mime)
  const imagen = await registrarImagen({
    url: up.url,
    key: up.key,
    descripcion: args.descripcion || args.alt || '',
    prompt: args.prompt,
    tags: args.tags || '',
    alt: args.alt || args.descripcion || '',
    grupo: args.grupo || '',
    subgrupo: args.subgrupo || '',
    aspect: args.aspect || '',
    origen: 'ai',
    modelo: img.modelo,
    creadoPor: args.creadoPor,
    kind: args.kind,
    campania: args.campania,
  })
  return { imagen, buffer, mime }
}

/**
 * Paso de CIERRE: toma una imagen ya subida (por su URL pública de R2), le pega el
 * logo de marca (mejor variante del banco grupo "marca", o el logo oficial), y sube
 * una copia branded. Devuelve la URL nueva (o la original si no se pudo). Esto es lo
 * que garantiza que TODO lo que publicamos lleve el logo, sin ensuciar el banco.
 */
export async function estamparLogoEnUrl(
  url: string,
  logos: ImagenBanco[],
  opts: { preferUrl?: string } = {},
): Promise<string> {
  try {
    if (!url) return url
    const key = keyFromPublicUrl(url) || ''
    let bytes = key ? await getFromR2(key) : null
    if (!bytes) {
      const r = await fetch(url)
      if (r.ok) bytes = Buffer.from(await r.arrayBuffer())
    }
    if (!bytes) return url
    const { buffer, aplicado } = await aplicarLogoMarca(bytes, logos, { preferUrl: opts.preferUrl })
    if (!aplicado) return url
    const jpeg = await sharp(buffer).flatten({ background: '#ffffff' }).jpeg({ quality: 88 }).toBuffer()
    const up = await uploadToR2(jpeg, `mailing/ai-images/${Date.now()}-logo.jpg`, 'image/jpeg')
    return up.url
  } catch (e) {
    console.warn('[mailing-images] no se pudo estampar el logo:', e)
    return url
  }
}

/**
 * Reasigna el grupo (y opcionalmente descripción/tags) de una imagen del banco.
 * Lee la fila y la reescribe COMPLETA (updateById sobreescribe toda la fila, así
 * que hay que mergear para no borrar las demás columnas).
 */
export async function actualizarImagen(
  id: string,
  cambios: { grupo?: string; subgrupo?: string; descripcion?: string; tags?: string; whatsapp?: boolean; favorita?: boolean },
): Promise<void> {
  await ensureBanco()
  const rows = await getSheetData(TABLE)
  const row = rows.find(r => String(r.id) === String(id))
  if (!row) throw new Error(`imagen ${id} no encontrada`)
  const merged = { ...row }
  if (cambios.grupo !== undefined) merged.grupo = cambios.grupo.trim()
  if (cambios.subgrupo !== undefined) merged.subgrupo = cambios.subgrupo.trim()
  if (cambios.descripcion !== undefined) merged.descripcion = cambios.descripcion.trim()
  if (cambios.tags !== undefined) merged.tags = cambios.tags.trim()
  if (cambios.whatsapp !== undefined) merged.whatsapp = cambios.whatsapp ? 'TRUE' : 'FALSE'
  if (cambios.favorita !== undefined) merged.favorita = cambios.favorita ? 'TRUE' : 'FALSE'
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
