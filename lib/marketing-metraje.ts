import { lanzarVideo, estadoVideo, isVeoConfigurado } from './veo'
import { guardarVideo } from './mailing-videos'

/**
 * METRAJE REAL para los videos de marca: clips generados con Veo.
 *
 * El montaje de fotos ya se lee como video, pero sigue siendo fotografía fija
 * con movimiento simulado. Esto trae movimiento de verdad — un perro corriendo
 * hacia su tutor, una mano acariciando — que es lo que pidió el dueño.
 *
 * Veo entrega clips de 8 s y tarda uno o dos minutos por clip, así que se
 * generan EN PARALELO y con un presupuesto de espera: si no llegan a tiempo, la
 * pieza sale igual con fotos y los clips quedan en el banco para la próxima.
 *
 * ⚠️ Vale la misma regla dura que para las fotos: NUNCA se genera metraje de
 * nuestras instalaciones. Esto es para escenas ilustrativas (mascotas, personas,
 * naturaleza), no para mostrar el crematorio.
 */

/** Cómo se ve un clip de marca: cálido, real, sin estridencia ni texto. */
const ESTILO = 'Cinematic, warm natural light, shallow depth of field, gentle slow camera movement, '
  + 'documentary realism, muted natural color palette. No text, no logos, no captions, no on-screen graphics.'

export interface ClipPedido {
  /** Qué se ve, en inglés (el modelo entiende mejor la terminología de cámara). */
  prompt: string
  /** 'reel' → 9:16 vertical; 'feed' → 9:16 también (se recorta al dibujar). */
  vertical?: boolean
}

export interface ClipListo {
  url: string
  codigo: string
  prompt: string
}

/** Espera a que una operación de Veo termine, sondeando cada `intervalo` ms. */
async function esperar(operacion: string, limiteMs: number, intervalo = 10_000): Promise<string | null> {
  const hasta = Date.now() + limiteMs
  while (Date.now() < hasta) {
    await new Promise(r => setTimeout(r, intervalo))
    const est = await estadoVideo(operacion).catch(() => null)
    if (!est) continue
    if (est.error) throw new Error(est.error)
    if (est.done) return est.uri || null
  }
  return null
}

/**
 * Genera `pedidos` clips y devuelve los que alcanzaron a estar listos dentro del
 * presupuesto. Los que llegan quedan guardados en el banco de videos.
 */
export async function generarMetraje(
  pedidos: ClipPedido[],
  opts: { limiteMs?: number; creadoPor?: string } = {},
): Promise<{ clips: ClipListo[]; avisos: string[] }> {
  const avisos: string[] = []
  if (!isVeoConfigurado()) return { clips: [], avisos: ['No hay metraje: falta GEMINI_API_KEY.'] }
  if (pedidos.length === 0) return { clips: [], avisos: [] }

  // El presupuesto tiene que dejar aire: después de esto todavía falta la
  // locución, la música y codificar el MP4, y la función corta a los 300 s.
  const limite = opts.limiteMs ?? 150_000

  // Se lanzan todos juntos: esperarlos en serie no entraría en el presupuesto.
  const operaciones = await Promise.all(pedidos.map(async p => {
    try {
      const op = await lanzarVideo({
        prompt: `${p.prompt.trim()} ${ESTILO}`,
        aspect: p.vertical === false ? '16:9' : '9:16',
        resolution: '1080p',
        durationSeconds: '8',
      })
      return { op, prompt: p.prompt }
    } catch (e) {
      avisos.push(`No pude lanzar un clip: ${e instanceof Error ? e.message : String(e)}`)
      return null
    }
  }))

  const clips: ClipListo[] = []
  await Promise.all(operaciones.filter(Boolean).map(async (o) => {
    const { op, prompt } = o as { op: string; prompt: string }
    try {
      const uri = await esperar(op, limite)
      if (!uri) { avisos.push('Un clip de video tardó más de lo esperado; quedará listo en el banco para la próxima pieza.'); return }
      const guardado = await guardarVideo({
        uri,
        prompt,
        descripcion: `Metraje de marca — ${prompt.slice(0, 80)}`,
        aspect: '9:16',
        duracion: '8',
        creadoPor: opts.creadoPor,
      })
      clips.push({ url: guardado.url, codigo: guardado.codigo, prompt })
    } catch (e) {
      avisos.push(`Un clip falló: ${e instanceof Error ? e.message : String(e)}`)
    }
  }))

  return { clips, avisos }
}
