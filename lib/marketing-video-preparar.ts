import { listarImagenes, generarYGuardarImagen } from './mailing-images'
import { isNanoBananaConfigurado } from './nano-banana'
import { listarVideos } from './mailing-videos'
import { generarGuion } from './marketing-guion'
import { generarLocucion, generarMusica, CLIMAS, VOZ_POR_DEFECTO } from './elevenlabs'
import { getFromR2, uploadToR2 } from './cloudflare-r2'
import { agregarPendiente, type VideoPendiente } from './marketing-video-pendientes'
import { armarVideo } from './marketing-video-armar'
import { generarMetraje } from './marketing-metraje'

/**
 * Deja un video PREPARADO para que el dueño solo apriete "Armar video".
 *
 * Hace todo lo que se puede hacer en el servidor — guion, fondo, locución y
 * música — y guarda el resultado en la bandeja de pendientes. El MP4 se arma en
 * el navegador (ver lib/video-marca.ts), así que ese último paso queda para la
 * pestaña Video.
 *
 * ── REGLA DURA SOBRE LAS INSTALACIONES ──────────────────────────────────────
 * El fondo puede GENERARSE (mascotas, personas, productos: son escenas
 * ilustrativas y nadie afirma que sean nuestras), pero las INSTALACIONES no:
 * esas salen siempre de las fotos REALES que sube el equipo al banco. Mostrar
 * un horno o una sala generada por IA mientras la voz dice "nuestras
 * instalaciones" sería mentirle al cliente.
 *
 * Se aplica por CÓDIGO, no por instrucción al modelo: `generarFondo` se niega a
 * generar si el grupo es `instalaciones`, y si el guion afirma algo sobre
 * nuestras instalaciones el fondo se fuerza a una foto real del banco.
 */

const BASE = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '')

/**
 * ¿El guion afirma algo sobre NUESTRAS instalaciones? Se busca la referencia
 * posesiva, no la palabra suelta: "Crematorio Alma Animal" no cuenta, pero
 * "nuestras instalaciones" o "nuestro horno" sí.
 */
const AFIRMA_INSTALACIONES = /\b(instalacion\w*|nuestr\w+\s+(horno|sala|planta|crematorio)|horno\s+propio|sala\s+de\s+(cremaci|refrigeraci))/i

export interface PrepararVideoArgs {
  tema: string
  segundos?: number
  /** key de CLIMAS, o '' / 'ninguna' para dejarlo sin música. */
  clima?: string
  formato?: 'reel' | 'feed'
  /** Código del banco (ej. "i-3"). Si no viene, se elige del grupo. */
  fondo_codigo?: string
  /** Grupo del banco del que elegir el fondo si no se dio un código. */
  grupo?: string
  /**
   * Prompt fotográfico para GENERAR el fondo en vez de sacarlo del banco.
   * Prohibido para instalaciones (ver la regla dura de arriba).
   */
  generar_prompt?: string
  /**
   * Escenas de METRAJE REAL a generar con Veo (en inglés), que se intercalan
   * con las fotos. Ej.: "a golden retriever running towards its owner in a
   * park". Prohibido para instalaciones.
   */
  metraje?: string[]
  creadoPor?: string
}

/** Grupo cuyas fotos NO se pueden generar nunca: tienen que ser reales. */
const GRUPO_REAL = 'instalaciones'

export async function prepararVideo(a: PrepararVideoArgs): Promise<{ pendiente: VideoPendiente; avisos: string[] }> {
  const avisos: string[] = []

  // 1) Guion (con las reglas de marca y su linter).
  const g = await generarGuion({ tema: a.tema, segundos: a.segundos })
  avisos.push(...g.avisos)

  // 2) Fondo: SIEMPRE del banco.
  const [imgs, vids] = await Promise.all([listarImagenes(), listarVideos()])
  const codigo = (a.fondo_codigo || '').trim().toLowerCase()
  type Toma = { url: string; tipo: 'imagen' | 'video'; codigo: string; grupo: string }
  let fondo: Toma | null = null
  // Tomas siguientes del montaje (la primera es `fondo`).
  const tomasExtra: Toma[] = []
  // Una toma cada ~5 s: suficiente para que se lea como video sin marear.
  const tomasPedidas = Math.min(6, Math.max(2, Math.round((a.segundos || 28) / 5)))

  if (codigo) {
    const img = imgs.find(i => (i.codigo || '').toLowerCase() === codigo)
    if (img) fondo = { url: img.url, tipo: 'imagen', codigo: img.codigo, grupo: img.grupo || 'otro' }
    else {
      const vid = vids.find(v => (v.codigo || '').toLowerCase() === codigo)
      if (vid) fondo = { url: vid.url, tipo: 'video', codigo: vid.codigo, grupo: 'video' }
    }
    if (!fondo) throw new Error(`No existe ninguna imagen ni video con el código "${a.fondo_codigo}" en el banco.`)
  } else if (a.generar_prompt?.trim()) {
    // Foto NUEVA para la pieza. Nunca de instalaciones.
    const grupo = (a.grupo || 'otro').trim().toLowerCase()
    if (grupo === GRUPO_REAL) {
      throw new Error('Las fotos de nuestras instalaciones no se generan: se usan las reales que sube el equipo al banco. Elegí una con consultar_banco_imagenes (grupo instalaciones) y pasá su código.')
    }
    if (!isNanoBananaConfigurado()) throw new Error('No puedo generar imágenes ahora (falta GEMINI_API_KEY). Elegí una del banco.')
    const { imagen } = await generarYGuardarImagen({
      prompt: a.generar_prompt.trim(),
      descripcion: `Fondo de video — ${a.tema}`,
      grupo,
      // Vertical: el video vive en reel/story.
      aspect: a.formato === 'feed' ? '4:5' : '9:16',
      creadoPor: a.creadoPor,
    })
    fondo = { url: imagen.url, tipo: 'imagen', codigo: imagen.codigo, grupo }
    avisos.push(`Generé la foto de fondo ${imagen.codigo} y quedó guardada en el banco (grupo ${grupo}).`)
  } else {
    const grupo = (a.grupo || '').trim().toLowerCase()
    const candidatas = grupo ? imgs.filter(i => (i.grupo || 'otro') === grupo) : imgs
    if (candidatas.length === 0) {
      throw new Error(grupo === GRUPO_REAL
        ? 'El banco no tiene ninguna foto del grupo "instalaciones", y esas NO se pueden generar: las sube el equipo. Pedile al dueño que suba una.'
        : grupo
        ? `El banco no tiene ninguna imagen del grupo "${grupo}". Podés generarla con generar_prompt o elegir otro grupo.`
        : 'El banco de imágenes está vacío.')
    }
    // Se prefiere una destacada con estrella: es la que el equipo eligió como buena.
    const elegida = candidatas.find(i => i.favorita) || candidatas[0]
    fondo = { url: elegida.url, tipo: 'imagen', codigo: elegida.codigo, grupo: elegida.grupo || 'otro' }
    // El resto del MONTAJE: más fotos del mismo grupo. Con una sola toma la
    // pieza se ve como una foto con audio, no como un video.
    const extras = candidatas.filter(i => i.url !== elegida.url).slice(0, Math.max(0, tomasPedidas - 1))
    for (const e of extras) tomasExtra.push({ url: e.url, tipo: 'imagen', codigo: e.codigo, grupo: e.grupo || 'otro' })
  }

  // 3) Guardarraíl: si el guion habla de nuestras instalaciones, la foto tiene
  //    que ser una REAL del grupo instalaciones.
  if (AFIRMA_INSTALACIONES.test(g.guion) && fondo.grupo !== GRUPO_REAL) {
    const hay = imgs.filter(i => (i.grupo || '') === GRUPO_REAL)
    if (hay.length === 0) {
      throw new Error(
        'El guion habla de nuestras instalaciones, pero el banco no tiene ninguna foto del grupo "instalaciones". ' +
        'Esas fotos las sube el equipo y no se pueden generar: subí una al banco, o pedime el video con otro enfoque.',
      )
    }
    const real = hay.find(i => i.favorita) || hay[0]
    fondo = { url: real.url, tipo: 'imagen', codigo: real.codigo, grupo: GRUPO_REAL }
    avisos.push(`El guion habla de nuestras instalaciones, así que usé la foto real ${real.codigo} del banco (grupo instalaciones) en vez de la que estaba elegida.`)
  }

  // 3.b) Metraje real: los clips de Veo abren el montaje (son lo que más
  //      "mueve") y las fotos completan. Si no llegan a tiempo, la pieza sale
  //      igual con fotos y los clips quedan en el banco.
  // Por DEFECTO se filma la escena que propuso el guion. Antes el metraje era
  // opcional y el agente no lo pedía nunca: todas las piezas salían con puras
  // fotos y el dueño veía "una foto con audio". Con `metraje: []` se apaga.
  const pedidas = a.metraje === undefined ? [g.escena] : a.metraje
  const escenas = pedidas.map(s => String(s || '').trim()).filter(Boolean).slice(0, 2)
  if (escenas.length && (a.grupo || '').trim().toLowerCase() !== GRUPO_REAL) {
    const { clips, avisos: avisosClips } = await generarMetraje(
      escenas.map(prompt => ({ prompt, vertical: a.formato !== 'feed' })),
      { creadoPor: a.creadoPor },
    )
    avisos.push(...avisosClips)
    if (clips.length) {
      // El primer clip pasa a ser la toma de apertura.
      const comoTomas = clips.map(c => ({ url: c.url, tipo: 'video' as const, codigo: c.codigo, grupo: 'metraje' }))
      tomasExtra.unshift(fondo, ...comoTomas.slice(1))
      fondo = comoTomas[0]
      avisos.push(`Metraje real: ${clips.map(c => c.codigo).join(', ')} (quedaron en el banco de videos).`)
    }
  }

  // 4) Locución.
  const loc = await generarLocucion(g.guion, VOZ_POR_DEFECTO)
  const keyVoz = `marketing/locuciones/${Date.now()}-agente.mp3`
  const { url: locucionUrl } = await uploadToR2(loc.mp3, keyVoz, 'audio/mpeg')

  // 5) Música (se reusa la cama del clima si ya existe, igual que en el panel).
  let musicaUrl = ''
  const climaKey = (a.clima || 'tierna').toLowerCase()
  const clima = climaKey === 'ninguna' || climaKey === '' ? null : CLIMAS.find(c => c.key === climaKey)
  if (climaKey && climaKey !== 'ninguna' && !clima) avisos.push(`No conozco el clima musical "${a.clima}"; usé "tierna".`)
  const climaFinal = clima || (climaKey === 'ninguna' || climaKey === '' ? null : CLIMAS[0])
  if (climaFinal) {
    const totalSeg = Math.min(120, Math.max(10, Math.ceil((loc.duracion + 2.5) / 10) * 10))
    const keyMus = `marketing/musica/${climaFinal.key}-${totalSeg}s.mp3`
    musicaUrl = `${BASE}/${keyMus}`
    const existe = await getFromR2(keyMus).catch(() => null)
    if (!existe) {
      const mp3 = await generarMusica(climaFinal.prompt, totalSeg * 1000)
      await uploadToR2(mp3, keyMus, 'audio/mpeg')
    }
  }

  // 6) El MP4 ya se arma acá: el dueño recibe el video terminado, no una tarea.
  //    Si el render falla (binario ausente, memoria), la pieza igual queda
  //    guardada y se puede armar desde el navegador en Marketing → Video.
  let videoUrl = ''
  try {
    const armado = await armarVideo({
      formato: a.formato === 'feed' ? 'feed' : 'reel',
      titulo: g.titulo,
      guion: g.guion,
      palabras: loc.palabras,
      duracion: loc.duracion,
      tomas: [fondo, ...tomasExtra].map(t => ({ url: t.url, tipo: t.tipo })),
      musicaUrl,
      locucionUrl,
      nombre: g.titulo,
    })
    videoUrl = armado.url
  } catch (e) {
    avisos.push(`El video quedó preparado pero no pude armar el MP4 en el servidor (${e instanceof Error ? e.message : String(e)}). Se puede armar desde Marketing → Video.`)
  }

  const pendiente = await agregarPendiente({
    tema: a.tema,
    titulo: g.titulo,
    guion: g.guion,
    locucion_url: locucionUrl,
    duracion: loc.duracion,
    palabras: loc.palabras,
    musica_url: musicaUrl,
    clima: climaFinal?.key || '',
    fondo_url: fondo.url,
    fondo_tipo: fondo.tipo,
    fondo_codigo: [fondo, ...tomasExtra].map(t => t.codigo).filter(Boolean).join(', '),
    fondo_grupo: fondo.grupo,
    tomas: [fondo, ...tomasExtra].map(t => ({ url: t.url, tipo: t.tipo })),
    formato: a.formato === 'feed' ? 'feed' : 'reel',
    video_url: videoUrl,
    creado_por: a.creadoPor || '',
  })

  return { pendiente, avisos }
}
