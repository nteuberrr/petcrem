/**
 * Generación de imágenes con Nano Banana (Gemini 2.5 Flash Image por defecto) vía la
 * API REST de Google Generative Language. Devuelve los bytes de la imagen para subirla a R2.
 *
 * Requiere GEMINI_API_KEY (API key de Google AI Studio). El modelo y la versión de
 * la API son configurables por entorno por si cambian los identificadores:
 *   GEMINI_IMAGE_MODEL   (default 'gemini-2.5-flash-image' = "Nano Banana", ~3x más
 *                         barato que la variante Pro. Como el TEXTO de las piezas se
 *                         dibuja con satori — no dentro de la foto IA — no se pierde la
 *                         ventaja del Pro. Para volver al Pro: 'gemini-3-pro-image-preview'.)
 *   GEMINI_API_VERSION   (default 'v1beta')
 *
 * Política de estilo (decisión de marca): TODAS las imágenes deben ser
 * FOTORREALISTAS — personas y mascotas reales, luz natural, nada de ilustración,
 * cartoon, 3D ni texto incrustado (el texto vive en el HTML del correo).
 */

import { ESTILO_MARCA_EN, ESTILO_GRAFICO_EN, PROHIBIDOS_EN } from './marca-visual'

const API_VERSION = process.env.GEMINI_API_VERSION || 'v1beta'
// "Nano Banana" (Gemini 2.5 Flash Image): ~3x más barato por imagen que la variante Pro.
// El texto de las piezas va en placas satori (no en la foto IA), así que la calidad de
// las fotos sin texto se mantiene. Override con GEMINI_IMAGE_MODEL=gemini-3-pro-image-preview.
const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image'

export function isNanoBananaConfigurado(): boolean {
  return !!process.env.GEMINI_API_KEY
}

/**
 * Estilo global que se añade SIEMPRE al prompt: fotorrealismo + la dirección
 * visual de marca (paleta, atmósfera y lo que JAMÁS debe aparecer). Esto último
 * vive en lib/marca-visual.ts (ESTILO_MARCA_EN) y se aplica acá porque nano-banana
 * es el único punto por el que pasa TODA imagen generada (social, correo, sueltas
 * y ediciones), aunque el prompt original no lo incluya.
 */
const STYLE_SUFFIX =
  'Photorealistic, natural editorial photography. Real people and real animals, lifelike and authentic, ' +
  'soft, flattering light (warm golden daylight for home/tender scenes; clean neutral light for professional scenes), ' +
  'shallow depth of field, high detail, warm and rich natural color with gentle depth — never flat or washed out. ' +
  'NOT an illustration, NOT a cartoon, NOT 3D render, NOT a painting, NOT CGI. ' +
  'No text, no words, no letters, no logos and no watermark overlaid on the image. ' +
  'Clean, uncluttered composition that works well as a standalone image or inside an email.\n' +
  ESTILO_MARCA_EN

/**
 * Modo GRÁFICO/DISEÑO (conTexto): para portadas, placas con datos y anuncios que
 * SÍ llevan texto integrado. A diferencia del modo foto, NO prohíbe el texto: pide
 * un diseño on-brand (línea de los correos) con el texto bien renderizado.
 */
const DESIGN_SUFFIX = ESTILO_GRAFICO_EN

/**
 * Modo EDICIÓN (image-to-image): cuando se manda una imagen base como referencia
 * y se quiere CAMBIAR SOLO UN DETALLE (no regenerar la escena). Sin esto, el
 * modelo trata la referencia como inspiración suelta y devuelve una imagen del
 * todo distinta. El prefijo le ordena PRESERVAR la base; el suffix es mínimo (solo
 * realismo + los prohibidos) para no empujarlo a recomponer todo.
 */
const EDIT_PREFIX =
  'You are EDITING the first image provided. Preserve it as-is — same subject, composition, framing, pose, background, colors, lighting and overall style — and modify ONLY the specific change requested below. Do NOT regenerate or reinvent the scene; everything not explicitly mentioned must stay identical to the original image.'
const EDIT_SUFFIX =
  'Keep the result photorealistic and visually consistent with the original image (same identity and style). ' +
  'No text, words or logos overlaid, unless a logo reference image is provided to place. ' +
  PROHIBIDOS_EN

const ASPECT_HINT: Record<string, string> = {
  '16:9': 'wide horizontal banner, 16:9',
  '21:9': 'ultra-wide horizontal banner, 21:9',
  '3:2': 'horizontal, 3:2',
  '4:3': 'horizontal, 4:3',
  '1:1': 'square, 1:1',
  '4:5': 'vertical portrait, 4:5',
  '3:4': 'vertical portrait, 3:4',
  '9:16': 'tall vertical, 9:16',
}

interface InlinePart {
  text?: string
  inlineData?: { data?: string; mimeType?: string }
  inline_data?: { data?: string; mime_type?: string }
}
interface GenResp {
  candidates?: Array<{ content?: { parts?: InlinePart[] }; finishReason?: string }>
  promptFeedback?: { blockReason?: string }
  error?: { message?: string }
}

export interface ImagenReferencia {
  data: Buffer
  mime: string
}

export interface GenerarImagenOpts {
  /** Descripción de la escena (la "dirección de arte"); en modo editar, SOLO el cambio. */
  prompt: string
  /** Relación de aspecto deseada, ej. '16:9'. Se ignora en modo editar (sigue la base). */
  aspect?: string
  /** Imágenes de referencia (ej. el logo de marca) para guiar el resultado. */
  referencias?: ImagenReferencia[]
  /**
   * Edición image-to-image: la PRIMERA referencia es la imagen base a preservar y
   * `prompt` describe SOLO el cambio. Mantiene composición/sujeto/encuadre y no
   * fuerza el aspecto. Requiere al menos una imagen en `referencias`.
   */
  editar?: boolean
  /**
   * Modo GRÁFICO: la pieza lleva TEXTO integrado (portada, placa con datos, anuncio).
   * Permite texto y usa el estilo de diseño on-brand en vez del de foto.
   */
  conTexto?: boolean
}

export interface ImagenGenerada {
  buffer: Buffer
  mime: string
  modelo: string
}

async function callApi(body: unknown, key: string): Promise<Response> {
  const url = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${MODEL}:generateContent`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 120_000)
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

/** Genera una imagen fotorrealista y devuelve sus bytes + mime. */
export async function generarImagen(opts: GenerarImagenOpts): Promise<ImagenGenerada> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY no configurada')
  if (!opts.prompt?.trim()) throw new Error('Falta el prompt de la imagen')

  // En edición la salida debe seguir el aspecto de la imagen base → no lo forzamos.
  const editar = !!opts.editar && (opts.referencias?.length ?? 0) > 0
  const conTexto = !!opts.conTexto && !editar
  const aspectTxt = !editar && opts.aspect && ASPECT_HINT[opts.aspect] ? ` Composition: ${ASPECT_HINT[opts.aspect]}.` : ''
  const fullPrompt = editar
    ? `${EDIT_PREFIX}\n\nREQUESTED CHANGE: ${opts.prompt.trim()}\n\n${EDIT_SUFFIX}`
    : conTexto
      ? `${opts.prompt.trim()}\n\n${DESIGN_SUFFIX}${aspectTxt}`
      : `${opts.prompt.trim()}\n\n${STYLE_SUFFIX}${aspectTxt}`

  const parts: InlinePart[] = []
  for (const ref of opts.referencias ?? []) {
    parts.push({ inline_data: { mime_type: ref.mime, data: ref.data.toString('base64') } })
  }
  parts.push({ text: fullPrompt })

  const baseBody = { contents: [{ parts }] }
  // Intento 1: con imageConfig.aspectRatio. Si la versión de la API no lo soporta
  // (400 por campo desconocido), reintento sin él (el aspecto igual va en el prompt).
  const bodies: unknown[] = [
    {
      ...baseBody,
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        ...(opts.aspect && !editar ? { imageConfig: { aspectRatio: opts.aspect } } : {}),
      },
    },
    { ...baseBody, generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } },
  ]

  let lastErr = ''
  for (let i = 0; i < bodies.length; i++) {
    let res: Response
    try {
      res = await callApi(bodies[i], key)
    } catch (e) {
      lastErr = e instanceof Error && e.name === 'AbortError' ? 'timeout (la generación tardó demasiado)' : String(e)
      continue
    }
    const raw = await res.text()
    let json: GenResp = {}
    try { json = JSON.parse(raw) as GenResp } catch { /* deja json vacío */ }

    if (!res.ok) {
      lastErr = json.error?.message || raw.slice(0, 300) || `HTTP ${res.status}`
      // Si el primer intento falló por config inválida, el segundo (sin imageConfig) puede salvarlo.
      if (i === 0 && (res.status === 400 || /imageConfig|aspectRatio|unknown|invalid/i.test(lastErr))) continue
      throw new Error(`Nano Banana: ${lastErr}`)
    }

    const partsOut = json.candidates?.[0]?.content?.parts ?? []
    for (const p of partsOut) {
      const inline = p.inlineData || p.inline_data
      const data = inline?.data
      if (data) {
        const mime = (p.inlineData?.mimeType || p.inline_data?.mime_type || 'image/png').toLowerCase()
        return { buffer: Buffer.from(data, 'base64'), mime, modelo: MODEL }
      }
    }
    // Respondió OK pero sin imagen → bloqueo de seguridad o solo texto.
    const block = json.promptFeedback?.blockReason || json.candidates?.[0]?.finishReason
    const txt = partsOut.map(p => p.text).filter(Boolean).join(' ').slice(0, 200)
    lastErr = block ? `sin imagen (${block})` : (txt || 'la API no devolvió imagen')
    throw new Error(`Nano Banana: ${lastErr}`)
  }
  throw new Error(`Nano Banana: ${lastErr || 'no se pudo generar la imagen'}`)
}

/** Extensión de archivo a partir del mime. */
export function extFromMime(mime: string): string {
  const m: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg',
    'image/webp': 'webp', 'image/gif': 'gif',
  }
  return m[mime.toLowerCase()] || 'png'
}
