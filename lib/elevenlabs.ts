/**
 * ElevenLabs — locución (voz en off) para las piezas de video de Marketing.
 *
 * Se pide el audio CON TIMESTAMPS (`/with-timestamps`): además del MP3 devuelve
 * en qué milisegundo suena cada carácter. Con eso el video quema subtítulos
 * sincronizados, que es lo que hace la diferencia en Instagram/Facebook, donde
 * la enorme mayoría mira sin sonido.
 *
 * Las voces viven en `VOCES`: son de la biblioteca pública y hay que agregarlas
 * UNA vez a la cuenta con `npx tsx scripts/agregar-voces-elevenlabs.ts`.
 */

const API = 'https://api.elevenlabs.io/v1'

/** Multilingüe v2: el que mejor entona en español (v3 todavía es alpha para TTS). */
const MODELO = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2'

export interface Voz {
  id: string
  nombre: string
  /** Cómo suena, para elegir sin escuchar. */
  describe: string
  /** Dueño en la biblioteca pública (lo necesita el alta en la cuenta). */
  publicOwnerId: string
  /** Nombre original en la biblioteca (el alta lo pide). */
  nombreBiblioteca: string
}

/**
 * Voces habilitadas: femeninas CHILENAS de perfil narrativo cálido.
 *
 * Primero se habían puesto voces "latinas neutras" (Lucy, Carito), pero al
 * escuchar la pieza sonaban rioplatenses — para una marca de Santiago eso
 * desentona. La biblioteca tiene voces chilenas y son las que quedaron.
 */
export const VOCES: Voz[] = [
  {
    id: 'prblQcKOdF08ozhxP2mk',
    nombre: 'Ángela',
    describe: 'Chilena, mediana edad — cálida, calmada, la que mejor calza',
    publicOwnerId: '',
    nombreBiblioteca: 'Angela',
  },
  {
    id: 'Fd38GRHtJllY0CuguAy9',
    nombre: 'Victoria',
    describe: 'Chilena, joven — narradora clara',
    publicOwnerId: '',
    nombreBiblioteca: 'Victoria',
  },
  {
    id: '6Gr4AVmTax1pMJO0lHRK',
    nombre: 'Catalina',
    describe: 'Chilena, joven — conversacional y cercana',
    publicOwnerId: '',
    nombreBiblioteca: 'Catalina',
  },
  {
    id: 'lLsDvdl6OjtZfLJPM2HA',
    nombre: 'Olivia',
    describe: 'Chilena, mediana edad — sobria, tono corporativo',
    publicOwnerId: '',
    nombreBiblioteca: 'Olivia Pro',
  },
]

export const VOZ_POR_DEFECTO = VOCES[0].id

export function isElevenLabsConfigurado(): boolean {
  return !!(process.env.ELEVENLABS_API_KEY || '').trim()
}

function headers(): Record<string, string> {
  const key = (process.env.ELEVENLABS_API_KEY || '').trim()
  if (!key) throw new Error('ELEVENLABS_API_KEY no configurada')
  return { 'xi-api-key': key, 'Content-Type': 'application/json' }
}

/** Una palabra del guion con su ventana de tiempo, para los subtítulos. */
export interface PalabraTiempo {
  palabra: string
  /** Segundos desde el inicio del audio. */
  desde: number
  hasta: number
}

export interface Locucion {
  mp3: Buffer
  palabras: PalabraTiempo[]
  /** Duración total en segundos. */
  duracion: number
}

/**
 * Agrupa la alineación por CARÁCTER que devuelve ElevenLabs en palabras.
 * Los espacios y signos se pegan a la palabra que viene antes.
 */
function agruparPalabras(chars: string[], inicios: number[], finales: number[]): PalabraTiempo[] {
  const out: PalabraTiempo[] = []
  let actual = ''
  let desde = 0
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    if (/\s/.test(c)) {
      if (actual.trim()) out.push({ palabra: actual.trim(), desde, hasta: finales[i - 1] ?? finales[i] ?? desde })
      actual = ''
      continue
    }
    if (!actual) desde = inicios[i] ?? 0
    actual += c
  }
  if (actual.trim()) {
    out.push({ palabra: actual.trim(), desde, hasta: finales[finales.length - 1] ?? desde })
  }
  return out
}

/**
 * Convierte el guion en audio. Devuelve el MP3 y la marca de tiempo de cada
 * palabra. `estabilidad` alta y `similitud` alta = lectura pareja y sin
 * sobreactuación, que es lo que corresponde al tema.
 */
export async function generarLocucion(texto: string, vozId = VOZ_POR_DEFECTO): Promise<Locucion> {
  const limpio = texto.trim()
  if (!limpio) throw new Error('El guion está vacío')
  if (limpio.length > 2500) throw new Error('El guion es demasiado largo (máximo 2.500 caracteres)')

  const r = await fetch(`${API}/text-to-speech/${encodeURIComponent(vozId)}/with-timestamps`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      text: limpio,
      model_id: MODELO,
      // Estabilidad alta y estilo bajo = lectura pareja, sin sobreactuación, que
      // es lo que corresponde al tema. `speed` apenas bajo 1 para que no suene
      // apurada: una locución de duelo se lee con calma.
      voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.15, speed: 0.95, use_speaker_boost: true },
    }),
  })
  if (!r.ok) {
    const detalle = await r.text().catch(() => '')
    throw new Error(`ElevenLabs respondió ${r.status}: ${detalle.slice(0, 300)}`)
  }
  const j = await r.json() as {
    audio_base64: string
    alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }
    normalized_alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }
  }

  const al = j.normalized_alignment || j.alignment
  const palabras = al
    ? agruparPalabras(al.characters, al.character_start_times_seconds, al.character_end_times_seconds)
    : []
  const duracion = palabras.length ? palabras[palabras.length - 1].hasta : 0

  return { mp3: Buffer.from(j.audio_base64, 'base64'), palabras, duracion }
}

// ── Música de fondo ─────────────────────────────────────────────────────────
// Se GENERA con ElevenLabs en vez de usar una pista cualquiera: viene con
// licencia comercial, así que la pieza se puede pautar sin riesgo de reclamo.
//
// Los prompts van en inglés (el modelo entiende mejor la terminología musical) y
// están escritos para que la música NO compita con la voz: sin percusión, sin
// crescendo y sin drama. Es una cama, no una canción.

export interface ClimaMusical {
  key: string
  label: string
  describe: string
  prompt: string
}

const BASE_PROMPT =
  'Slow tempo around 65 BPM. Intimate and comforting, never sad, dramatic or epic. ' +
  'No percussion, no vocals, no build-up, no crescendo — it must sit quietly under a spoken voice-over. ' +
  'Simple, sparse and consistent from start to finish.'

export const CLIMAS: ClimaMusical[] = [
  {
    key: 'tierna',
    label: 'Tierna',
    describe: 'Piano suave con cuerdas cálidas — cercana y luminosa',
    prompt: `Gentle, tender instrumental for a pet memorial brand video. Soft solo piano with warm sustained strings underneath, major key with a bittersweet, hopeful feel. ${BASE_PROMPT}`,
  },
  {
    key: 'serena',
    label: 'Serena',
    describe: 'Cuerdas y pads muy tenues — sobria, casi ambiental',
    prompt: `Calm, serene ambient instrumental for a memorial brand video. Soft sustained strings and warm analog pads, very few notes, gentle and restrained. ${BASE_PROMPT}`,
  },
  {
    key: 'calida',
    label: 'Cálida',
    describe: 'Guitarra acústica con arpegios — cercana y humana',
    prompt: `Warm acoustic instrumental for a memorial brand video. Softly fingerpicked nylon guitar arpeggios with a faint string pad, major key, human and close. ${BASE_PROMPT}`,
  },
]

/**
 * Genera una cama musical de `ms` milisegundos. Devuelve el MP3.
 *
 * `music_v2` (el endpoint sigue cayendo a v1 por compatibilidad si no se pide),
 * `force_instrumental` para que NUNCA aparezca una voz cantando encima de la
 * locución — pedirlo en el prompt no lo garantiza — y MP3 a 192 kbps.
 */
export async function generarMusica(prompt: string, ms: number): Promise<Buffer> {
  const largo = Math.min(120_000, Math.max(10_000, Math.round(ms)))
  const r = await fetch(`${API}/music?output_format=mp3_44100_192`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      prompt,
      music_length_ms: largo,
      model_id: process.env.ELEVENLABS_MUSIC_MODEL || 'music_v2',
      force_instrumental: true,
    }),
  })
  if (!r.ok) {
    const detalle = await r.text().catch(() => '')
    throw new Error(`ElevenLabs (música) respondió ${r.status}: ${detalle.slice(0, 300)}`)
  }
  return Buffer.from(await r.arrayBuffer())
}

/** Voces que la cuenta tiene realmente disponibles (para avisar si falta alguna). */
export async function vocesEnLaCuenta(): Promise<Set<string>> {
  const r = await fetch(`${API}/voices`, { headers: headers() })
  if (!r.ok) return new Set()
  const j = await r.json() as { voices?: Array<{ voice_id: string }> }
  return new Set((j.voices || []).map(v => v.voice_id))
}
