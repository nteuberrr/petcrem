/**
 * Cliente de VEO 3.1 (generación de VIDEO de Google) vía la Gemini API.
 *
 * OJO: el video es OTRO modelo distinto de Nano Banana (que es solo imagen) y es
 * ASÍNCRONO: se lanza un job (predictLongRunning) que devuelve el nombre de una
 * "operación", se SONDEA hasta que `done=true` y recién ahí se descarga el MP4.
 * Usa la MISMA GEMINI_API_KEY que las imágenes (pero Veo es de pago, sin capa free).
 *
 * Patrón recomendado: tomar una imagen ya generada con Nano Banana como primer
 * frame (image-to-video) y que Veo la anime — más control de marca y de costo.
 */

const API_VERSION = process.env.GEMINI_API_VERSION || 'v1beta'
// Quality por defecto (pocos videos, prioridad calidad). Override con GEMINI_VIDEO_MODEL.
// Opciones: veo-3.1-generate-preview (quality) | veo-3.1-fast-generate-preview | veo-3.1-lite-generate-preview
export const VEO_MODEL = process.env.GEMINI_VIDEO_MODEL || 'veo-3.1-generate-preview'
const BASE = 'https://generativelanguage.googleapis.com'

export function isVeoConfigurado(): boolean {
  return !!process.env.GEMINI_API_KEY
}

export interface LanzarVideoOpts {
  /** Descripción del movimiento/escena del video. */
  prompt: string
  /** Imagen del primer frame (image-to-video). Si se omite, es text-to-video. */
  imagen?: { data: Buffer; mime: string }
  /** '16:9' (horizontal) | '9:16' (vertical). */
  aspect?: string
  /** '720p' | '1080p'. */
  resolution?: string
  /** '4' | '6' | '8' (segundos; máx 8 por clip). */
  durationSeconds?: string
}

/**
 * Lanza la generación de video (async). Devuelve el NOMBRE de la operación para
 * sondear con estadoVideo(). No espera a que termine.
 */
export async function lanzarVideo(opts: LanzarVideoOpts): Promise<string> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY no configurada')
  if (!opts.prompt?.trim()) throw new Error('Falta el prompt del video')

  const instance: Record<string, unknown> = { prompt: opts.prompt.trim() }
  if (opts.imagen) {
    instance.image = { inlineData: { mimeType: opts.imagen.mime, data: opts.imagen.data.toString('base64') } }
  }
  const body = {
    instances: [instance],
    parameters: {
      aspectRatio: opts.aspect || '16:9',
      resolution: opts.resolution || '1080p',
      durationSeconds: opts.durationSeconds || '8',
    },
  }
  const r = await fetch(`${BASE}/${API_VERSION}/models/${VEO_MODEL}:predictLongRunning`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({})) as { name?: string; error?: { message?: string } }
  if (!r.ok) throw new Error(j?.error?.message || `Veo HTTP ${r.status}`)
  if (!j?.name) throw new Error('Veo no devolvió el nombre de la operación')
  return j.name
}

export interface EstadoVideo {
  done: boolean
  /** URI para descargar el MP4 (cuando done=true y no hubo error). */
  uri?: string
  error?: string
}

interface OperationResp {
  done?: boolean
  error?: { message?: string }
  response?: { generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> } }
}

/** Consulta el estado de la operación. done=false = sigue generando. */
export async function estadoVideo(operationName: string): Promise<EstadoVideo> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY no configurada')
  const r = await fetch(`${BASE}/${API_VERSION}/${operationName}`, { headers: { 'x-goog-api-key': key } })
  const j = await r.json().catch(() => ({})) as OperationResp & { error?: { message?: string } }
  if (!r.ok) throw new Error(j?.error?.message || `Veo estado HTTP ${r.status}`)
  if (!j?.done) return { done: false }
  if (j?.error?.message) return { done: true, error: j.error.message }
  const uri = j?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri
  if (!uri) return { done: true, error: 'La operación terminó pero no devolvió el video.' }
  return { done: true, uri }
}

/** Descarga los bytes del video terminado (requiere la API key en el header). */
export async function descargarVideo(uri: string): Promise<{ buffer: Buffer; mime: string }> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY no configurada')
  const r = await fetch(uri, { headers: { 'x-goog-api-key': key } })
  if (!r.ok) throw new Error(`No se pudo descargar el video (HTTP ${r.status})`)
  const mime = r.headers.get('content-type') || 'video/mp4'
  return { buffer: Buffer.from(await r.arrayBuffer()), mime }
}
