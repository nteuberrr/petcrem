/**
 * Armador del VIDEO de marca (solo navegador).
 *
 * Por qué en el navegador y no en el servidor: armar un MP4 necesita un
 * codificador, y en Vercel no hay ffmpeg (el binario estático no entra en el
 * bundle y el plan Hobby corta las funciones a 60 s). El navegador ya trae uno:
 * se dibujan los cuadros en un <canvas>, se captura su stream junto al audio y
 * MediaRecorder entrega un MP4 con H.264 + AAC. Sin costo de servidor y sin
 * límite de tiempo.
 *
 * ── DEFINICIÓN DE LA PIEZA ──────────────────────────────────────────────────
 * La marca es sobria y el contexto es duelo, así que el video NO tiene cortes,
 * rebotes, ni música. Todo el movimiento es un zoom lentísimo.
 *
 *   · Fondo: la foto con Ken Burns (escala 1,00 → 1,07 en toda la pieza) bajo un
 *     velo navy que la baja de contraste y deja legible el texto.
 *   · Entrada: 0,5 s de fundido desde el navy de marca.
 *   · Título: aparece a los 0,6 s, arriba (fuera de donde Instagram pone su
 *     interfaz), con una línea dorada fina debajo. Una idea, no el eslogan.
 *   · Subtítulos: sincronizados palabra por palabra con la locución, porque en
 *     Instagram y Facebook la mayoría mira SIN sonido. La palabra que suena va
 *     en dorado; el resto en blanco.
 *   · Cierre: los últimos 2,5 s el fondo se funde a navy y queda el logo con el
 *     eslogan centrado.
 *   · Paleta: navy #143C64 de estructura, blanco/crema para el texto y dorado
 *     solo como acento (la regla 60-30-10 de la marca).
 */

export const NAVY = '#143C64'
export const DORADO = '#F2B84B'
export const CREMA = '#FBF8F3'

export type FormatoVideo = 'reel' | 'feed'

export const FORMATOS: Record<FormatoVideo, { w: number; h: number; label: string }> = {
  reel: { w: 1080, h: 1920, label: 'Reel / Story (9:16)' },
  feed: { w: 1080, h: 1350, label: 'Feed (4:5)' },
}

export interface PalabraTiempo { palabra: string; desde: number; hasta: number }

/**
 * Una TOMA de la pieza: una foto del banco o un clip ya generado con Veo.
 *
 * La pieza es un MONTAJE, no una foto con audio: varias tomas encadenadas con
 * fundido y con movimiento propio cada una. Con una sola toma y un zoom sutil
 * el resultado no se lee como video — pasó en la primera versión.
 */
export type Toma =
  | { tipo: 'imagen'; el: HTMLImageElement }
  | { tipo: 'video'; el: HTMLVideoElement }

/** Cuánto dura el fundido entre tomas. */
export const FUNDIDO = 0.7

/**
 * Reparte `n` tomas a lo largo de la pieza, solapándolas para el fundido.
 * Cada toma dura lo mismo y ninguna baja de ~2,2 s (menos que eso se ve nervioso).
 */
export function planificarTomas(n: number, total: number): Array<{ desde: number; hasta: number }> {
  const cant = Math.max(1, n)
  if (cant === 1) return [{ desde: 0, hasta: total }]
  const dur = Math.max(2.2, (total + (cant - 1) * FUNDIDO) / cant)
  const paso = dur - FUNDIDO
  return Array.from({ length: cant }, (_, i) => ({
    desde: i * paso,
    hasta: Math.min(total, i * paso + dur),
  }))
}

export interface OpcionesVideo {
  formato: FormatoVideo
  /** Tomas ya cargadas (mismo origen, para no ensuciar el canvas). */
  tomas: Toma[]
  /** Logo de marca sobre fondo oscuro, ya cargado. */
  logo: HTMLImageElement | null
  titulo: string
  palabras: PalabraTiempo[]
  /** Duración de la locución, en segundos. */
  duracionAudio: number
  /** Familia tipográfica ya disponible en el documento. */
  fuente: string
}

const CIERRE = 2.5      // segundos del cierre de marca
const ENTRADA = 0.5     // fundido de entrada
const SALIDA = 0.4      // fundido final

/** Duración total de la pieza. */
export function duracionTotal(duracionAudio: number): number {
  return Math.max(4, duracionAudio + CIERRE)
}

/** Agrupa las palabras en líneas de subtítulo de ~3,2 s o corte de frase. */
export function agruparSubtitulos(palabras: PalabraTiempo[]): PalabraTiempo[][] {
  const grupos: PalabraTiempo[][] = []
  let actual: PalabraTiempo[] = []
  for (const p of palabras) {
    actual.push(p)
    const dur = actual[actual.length - 1].hasta - actual[0].desde
    const cierraFrase = /[.,;:!?]$/.test(p.palabra)
    if ((cierraFrase && dur > 1.2) || dur > 3.2 || actual.length >= 8) {
      grupos.push(actual)
      actual = []
    }
  }
  if (actual.length) grupos.push(actual)
  return grupos
}

/** Suaviza 0→1 (arranca y termina sin tirón). */
const suave = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))

/** Parte un texto en líneas que entren en `maxW`. */
function envolver(ctx: CanvasRenderingContext2D, texto: string, maxW: number): string[] {
  const palabras = texto.split(/\s+/).filter(Boolean)
  const out: string[] = []
  let linea = ''
  for (const w of palabras) {
    const prueba = linea ? `${linea} ${w}` : w
    if (ctx.measureText(prueba).width > maxW && linea) { out.push(linea); linea = w }
    else linea = prueba
  }
  if (linea) out.push(linea)
  return out
}

/**
 * Dibuja UN cuadro del video en el segundo `t`. Es una función pura respecto del
 * tiempo: sirve igual para la vista previa en vivo y para la grabación.
 */
export function dibujarCuadro(ctx: CanvasRenderingContext2D, o: OpcionesVideo, t: number): void {
  const { w, h } = FORMATOS[o.formato]
  const total = duracionTotal(o.duracionAudio)
  const grupos = agruparSubtitulos(o.palabras)

  ctx.save()
  ctx.fillStyle = NAVY
  ctx.fillRect(0, 0, w, h)

  // ── Montaje de tomas ─────────────────────────────────────────────────────
  // Cada toma tiene su propio movimiento (zoom alternado in/out + paneo suave)
  // y entra con fundido sobre la anterior. Un clip de Veo no lleva zoom: ya se
  // mueve solo y encimarle otro movimiento lo deja mareado.
  const plan = planificarTomas(o.tomas.length, total)
  o.tomas.forEach((toma, i) => {
    const { desde, hasta } = plan[i]
    if (t < desde - 0.01 || t > hasta) return
    const esVideo = toma.tipo === 'video'
    const src = toma.el
    // `naturalWidth` en el navegador, `width` en el canvas de Node
    // (@napi-rs/canvas): esta función dibuja la vista previa Y el MP4.
    const dim = src as unknown as { naturalWidth?: number; width?: number; naturalHeight?: number; height?: number }
    const fw = esVideo ? (src as HTMLVideoElement).videoWidth : (dim.naturalWidth || dim.width || 0)
    const fh = esVideo ? (src as HTMLVideoElement).videoHeight : (dim.naturalHeight || dim.height || 0)
    if (fw <= 0 || fh <= 0) return

    const p = Math.min(1, Math.max(0, (t - desde) / Math.max(0.1, hasta - desde)))
    // Las tomas pares acercan y las impares alejan: el corte se nota y la pieza
    // deja de parecer una foto quieta.
    const acerca = i % 2 === 0
    const escala = esVideo ? 1 : (acerca ? 1.04 + 0.12 * p : 1.16 - 0.12 * p)
    const rel = Math.max(w / fw, h / fh) * escala
    const iw = fw * rel
    const ih = fh * rel
    const paneo = esVideo ? 0 : (acerca ? 1 : -1) * h * 0.03 * (p - 0.5)
    const alfa = i === 0 ? 1 : Math.min(1, (t - desde) / FUNDIDO)

    ctx.globalAlpha = alfa
    ctx.drawImage(src, (w - iw) / 2, (h - ih) / 2 + paneo, iw, ih)
    ctx.globalAlpha = 1
  })

  // Velo de marca: baja el contraste de la foto y unifica la paleta.
  ctx.fillStyle = 'rgba(20, 60, 100, 0.30)'
  ctx.fillRect(0, 0, w, h)
  const deg = ctx.createLinearGradient(0, 0, 0, h)
  deg.addColorStop(0, 'rgba(15, 46, 77, 0.72)')
  deg.addColorStop(0.35, 'rgba(15, 46, 77, 0.10)')
  deg.addColorStop(0.62, 'rgba(15, 46, 77, 0.35)')
  deg.addColorStop(1, 'rgba(15, 46, 77, 0.88)')
  ctx.fillStyle = deg
  ctx.fillRect(0, 0, w, h)

  // ── Título ───────────────────────────────────────────────────────────────
  const tituloIn = suave((t - 0.6) / 0.9)
  // El título es una PLACA de apertura, no un rótulo permanente: se va a los
  // ~7 s. Quedándose toda la pieza competía con los subtítulos y, con montaje,
  // dejaba la sensación de que nada cambiaba.
  const finTitulo = Math.min(7, Math.max(3.5, o.duracionAudio - 2))
  const tituloOut = 1 - suave((t - finTitulo) / 0.7)
  const alfaTitulo = Math.min(tituloIn, tituloOut)
  if (alfaTitulo > 0.01 && o.titulo) {
    const size = Math.round(w * 0.072)
    ctx.font = `700 ${size}px ${o.fuente}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const margen = w * 0.1
    const lineas = envolver(ctx, o.titulo, w - margen * 2)
    // Sube 14 px mientras entra: el texto "se asienta", no aparece de golpe.
    const y0 = h * 0.13 + 14 * (1 - tituloIn)
    ctx.globalAlpha = alfaTitulo
    ctx.fillStyle = '#FFFFFF'
    ctx.shadowColor = 'rgba(10, 30, 50, 0.55)'
    ctx.shadowBlur = Math.round(w * 0.02)
    lineas.forEach((l, i) => ctx.fillText(l, w / 2, y0 + i * size * 1.18))
    ctx.shadowBlur = 0
    // Línea dorada: el acento, fino y corto.
    const yLinea = y0 + lineas.length * size * 1.18 + size * 0.34
    ctx.fillStyle = DORADO
    ctx.fillRect(w / 2 - w * 0.06, yLinea, w * 0.12, Math.max(3, w * 0.004))
    ctx.globalAlpha = 1
  }

  // ── Subtítulos sincronizados ─────────────────────────────────────────────
  if (t <= o.duracionAudio + 0.15) {
    const grupo = grupos.find(g => t >= g[0].desde - 0.12 && t <= g[g.length - 1].hasta + 0.35)
    if (grupo) {
      const size = Math.round(w * 0.052)
      ctx.font = `600 ${size}px ${o.fuente}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const margen = w * 0.09
      const maxW = w - margen * 2

      // Se reparte el grupo en líneas sin romper palabras, conservando cuál suena.
      const lineas: PalabraTiempo[][] = []
      let linea: PalabraTiempo[] = []
      for (const p of grupo) {
        const prueba = [...linea, p].map(x => x.palabra).join(' ')
        if (ctx.measureText(prueba).width > maxW && linea.length) { lineas.push(linea); linea = [p] }
        else linea.push(p)
      }
      if (linea.length) lineas.push(linea)

      // Zona baja pero por encima de la interfaz de Instagram.
      const yBase = h * (o.formato === 'reel' ? 0.74 : 0.79)
      const alto = lineas.length * size * 1.3

      // Fondo apenas perceptible: asegura lectura sobre fotos claras.
      ctx.fillStyle = 'rgba(15, 46, 77, 0.42)'
      const padX = w * 0.05
      const anchoCaja = Math.min(w - margen, Math.max(...lineas.map(l => ctx.measureText(l.map(x => x.palabra).join(' ')).width)) + padX * 2)
      redondeado(ctx, (w - anchoCaja) / 2, yBase - alto / 2 - size * 0.42, anchoCaja, alto + size * 0.5, size * 0.28)
      ctx.fill()

      lineas.forEach((ln, i) => {
        const textoLinea = ln.map(x => x.palabra).join(' ')
        const anchoLinea = ctx.measureText(textoLinea).width
        let x = w / 2 - anchoLinea / 2
        const y = yBase - alto / 2 + size * 0.65 + i * size * 1.3
        ctx.textAlign = 'left'
        for (const p of ln) {
          const suena = t >= p.desde - 0.05 && t <= p.hasta + 0.05
          ctx.fillStyle = suena ? DORADO : '#FFFFFF'
          ctx.fillText(p.palabra, x, y)
          x += ctx.measureText(`${p.palabra} `).width
        }
      })
    }
  }

  // ── Cierre de marca ──────────────────────────────────────────────────────
  const cierre = suave((t - o.duracionAudio) / (CIERRE * 0.45))
  if (cierre > 0.01) {
    ctx.globalAlpha = cierre * 0.94
    ctx.fillStyle = NAVY
    ctx.fillRect(0, 0, w, h)
    ctx.globalAlpha = cierre
    if (o.logo) {
      const anchoLogo = w * 0.46
      const altoLogo = (o.logo.height / o.logo.width) * anchoLogo
      ctx.drawImage(o.logo, (w - anchoLogo) / 2, h / 2 - altoLogo / 2, anchoLogo, altoLogo)
    } else {
      ctx.font = `700 ${Math.round(w * 0.075)}px ${o.fuente}`
      ctx.fillStyle = CREMA
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('Alma Animal', w / 2, h / 2 - w * 0.03)
      ctx.font = `400 ${Math.round(w * 0.036)}px ${o.fuente}`
      ctx.fillStyle = DORADO
      ctx.fillText('Huellas que no se borran', w / 2, h / 2 + w * 0.05)
    }
    ctx.globalAlpha = 1
  }

  // ── Fundidos de entrada y salida ─────────────────────────────────────────
  const entrada = 1 - suave(t / ENTRADA)
  const salida = suave((t - (total - SALIDA)) / SALIDA)
  const negro = Math.max(entrada, salida)
  if (negro > 0.01) {
    ctx.globalAlpha = negro
    ctx.fillStyle = NAVY
    ctx.fillRect(0, 0, w, h)
    ctx.globalAlpha = 1
  }
  ctx.restore()
}

function redondeado(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** El mejor contenedor que soporte el navegador. MP4 es el que aceptan IG y FB. */
export function formatoGrabacion(): { mime: string; ext: string; esMp4: boolean } | null {
  const candidatos = [
    { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4', esMp4: true },
    { mime: 'video/mp4', ext: 'mp4', esMp4: true },
    { mime: 'video/webm;codecs=vp9,opus', ext: 'webm', esMp4: false },
    { mime: 'video/webm', ext: 'webm', esMp4: false },
  ]
  if (typeof MediaRecorder === 'undefined') return null
  return candidatos.find(c => MediaRecorder.isTypeSupported(c.mime)) || null
}
