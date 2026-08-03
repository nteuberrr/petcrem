import Anthropic from '@anthropic-ai/sdk'
import { REGLAS_INVIOLABLES, TERMINOS_PROHIBIDOS } from './marca-voz'
import { DIFERENCIADORES, MODALIDADES_SERVICIOS } from './diferenciadores'

/**
 * Guion de la locución de un video de Marketing.
 *
 * No es el copy de un post: un caption se LEE y un guion se ESCUCHA. Acá se pide
 * texto para decir en voz alta — frases cortas, sin listas, sin emojis, sin
 * signos que la voz no pueda pronunciar — calibrado a los segundos que dura la
 * pieza. El resto de la voz de marca sale de las reglas inviolables, las mismas
 * que usan las piezas gráficas.
 */

const MODELO = process.env.ANTHROPIC_MAILING_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'

/** ~2,6 palabras por segundo es el ritmo cómodo de una locución pausada. */
const PALABRAS_POR_SEGUNDO = 2.6

export interface GuionGenerado {
  /** Lo que dice la voz. */
  guion: string
  /** Título corto que se sobreimprime al inicio (máx ~38 caracteres). */
  titulo: string
  /** Toma de apertura a FILMAR con Veo, en inglés (metraje real). */
  escena: string
  /** Palabras estimadas / segundos estimados. */
  palabras: number
  segundos: number
  avisos: string[]
}

export function isGuionConfigurado(): boolean {
  return !!process.env.ANTHROPIC_API_KEY
}

/** Saca lo que una voz no puede leer: emojis, viñetas, markdown, flechas. */
function limpiarParaVoz(t: string): string {
  return t
    .replace(/[\p{Extended_Pictographic}←-⇿⬀-⯿]/gu, '')
    .replace(/^\s*[-*•–]\s+/gm, '')
    .replace(/[*_#`]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

/** Recorta a `max` caracteres sin partir una palabra por la mitad. */
function recortarPorPalabra(t: string, max: number): string {
  const limpio = t.replace(/\s+/g, ' ').trim()
  if (limpio.length <= max) return limpio
  const corte = limpio.slice(0, max)
  const espacio = corte.lastIndexOf(' ')
  return (espacio > max * 0.5 ? corte.slice(0, espacio) : corte).replace(/[\s,;:.-]+$/, '')
}

export async function generarGuion(args: {
  tema: string
  segundos?: number
  audiencia?: 'tutores' | 'veterinarios'
}): Promise<GuionGenerado> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY no configurada')
  const segundos = Math.min(45, Math.max(12, args.segundos || 28))
  const objetivo = Math.round(segundos * PALABRAS_POR_SEGUNDO)
  const audiencia = args.audiencia || 'tutores'

  const sys = `${REGLAS_INVIOLABLES}

Escribes el GUION de la locución de un video corto de Crematorio Alma Animal (Recoleta, Santiago; cremación de mascotas).

QUÉ ES UN GUION DE LOCUCIÓN (y no un post):
- Se ESCUCHA, no se lee. Frases cortas, de una idea cada una, en el orden en que se entienden al oírlas.
- Nada de listas, viñetas, emojis, hashtags, "link en bio", paréntesis ni comillas: la voz no los pronuncia.
- Números y horarios EN PALABRAS ("cuatro días hábiles", "de nueve de la mañana a diez de la noche"), así la voz no los lee mal.
- Arranca por lo que le importa a quien escucha, no por el nombre de la marca.
- Cierra con UNA sola acción concreta (escribir por WhatsApp, llamar, visitar el sitio). Sin urgencia falsa ni promociones.
- Tono: ${audiencia === 'veterinarios'
    ? 'profesional y directo, de socio confiable: plazos, procesos y datos. Menos carga emocional.'
    : 'cercano y contenido, tuteo. Serio y humano, nunca solemne ni dulzón. Quien escucha está en duelo: se informa, no se consuela.'}

LARGO: ${objetivo} palabras aproximadamente (${segundos} segundos leídos en voz pausada). Es un límite real: pasarse arruina la pieza.

HECHOS DEL NEGOCIO (los únicos que puedes afirmar):
${DIFERENCIADORES}

${MODALIDADES_SERVICIOS}

${REGLAS_INVIOLABLES}

Responde SOLO con un JSON: {"titulo": "...", "guion": "...", "escena": "..."}
- "titulo": máximo 38 caracteres, es el texto que se sobreimprime en pantalla al inicio. Una idea concreta, NUNCA el eslogan ni el nombre de la marca (esos ya van en el logo).
- "guion": el texto corrido que dice la voz. Sin encabezados ni acotaciones de escena.
- "escena": EN INGLÉS, la toma de apertura que se va a FILMAR (8 segundos, vertical). Una escena real y simple con movimiento: una mascota, un tutor, un gesto cotidiano. Describe sujeto, acción, luz y cámara. NUNCA nuestras instalaciones, ni hornos, ni salas, ni nada del crematorio: eso se muestra solo con fotos reales. Nada de texto ni logos en la imagen. Ej.: "A golden retriever resting its head on its owner's lap on a sofa, soft window light, slow push-in, shallow depth of field".`

  const client = new Anthropic({ apiKey: key })

  /** Pide un guion; `correcciones` reinyecta lo que falló en el intento previo. */
  const pedir = async (correcciones: string[]) => {
    const mensaje = correcciones.length
      ? `Tema del video: ${args.tema}\n\nEl intento anterior ROMPIÓ estas reglas. Reescribilo corrigiéndolas:\n${correcciones.map(c => `- ${c}`).join('\n')}`
      : `Tema del video: ${args.tema}`
    const r = await client.messages.create({
      model: MODELO, max_tokens: 1200, system: sys,
      messages: [{ role: 'user', content: mensaje }],
    })
    const texto = r.content.map(c => (c.type === 'text' ? c.text : '')).join('').trim()
    const json = texto.match(/\{[\s\S]*\}/)
    if (!json) throw new Error('El agente no devolvió un guion utilizable')
    const parsed = JSON.parse(json[0]) as { titulo?: string; guion?: string; escena?: string }
    return {
      guion: limpiarParaVoz(String(parsed.guion || '')),
      // Se recorta por PALABRA: un slice a lo bruto dejaba títulos como
      // "Tus cenizas listas en cuatro días hábi" quemados en el video.
      titulo: recortarPorPalabra(limpiarParaVoz(String(parsed.titulo || '')), 42),
      escena: String(parsed.escena || '').trim(),
    }
  }

  /** Reglas de marca rotas (mismo linter que las piezas gráficas). */
  const revisar = (g: string, t: string) =>
    TERMINOS_PROHIBIDOS.filter(r => r.patron.test(g) || r.patron.test(t)).map(r => r.mensaje)

  let { guion, titulo, escena } = await pedir([])
  let rotas = revisar(guion, titulo)
  // Un aviso no alcanza: el texto termina QUEMADO en el video. Si rompió una
  // regla dura (voseo, clichés, "urna"…), se rehace inyectando el error.
  if (rotas.length) {
    const otro = await pedir(rotas)
    const rotasOtro = revisar(otro.guion, otro.titulo)
    if (rotasOtro.length < rotas.length) { guion = otro.guion; titulo = otro.titulo; escena = otro.escena; rotas = rotasOtro }
  }
  if (!guion) throw new Error('El guion salió vacío')
  const avisos = rotas.length ? [`El guion sigue rompiendo reglas de marca: ${rotas.join(' ')}`] : []
  const palabras = guion.split(/\s+/).filter(Boolean).length
  const estimados = Math.round(palabras / PALABRAS_POR_SEGUNDO)
  if (estimados > segundos + 6) avisos.push(`El guion dura ~${estimados} s, más de los ${segundos} s pedidos. Acórtalo o sube la duración.`)

  return { guion, titulo, escena, palabras, segundos: estimados, avisos }
}
