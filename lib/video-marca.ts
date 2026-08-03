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
 * Fondo de la pieza: una foto del banco o un video ya generado con Veo. Si es
 * video no se le aplica Ken Burns — ya tiene su propio movimiento y sumarle otro
 * lo deja mareado.
 */
export type Fondo =
  | { tipo: 'imagen'; el: HTMLImageElement }
  | { tipo: 'video'; el: HTMLVideoElement }

export interface OpcionesVideo {
  formato: FormatoVideo
  /** Fondo ya cargado (mismo origen, para no ensuciar el canvas). */
  fondo: Fondo
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

  // ── Fondo ────────────────────────────────────────────────────────────────
  // Foto: Ken Burns lentísimo. Video de Veo: se deja tal cual (ya tiene su
  // propio movimiento; encimarle un zoom lo deja mareado).
  const avance = Math.min(1, t / total)
  const esVideo = o.fondo.tipo === 'video'
  const src = o.fondo.el
  // `naturalWidth` en el navegador, `width` en el canvas de Node (@napi-rs/canvas):
  // esta misma función dibuja la vista previa Y el MP4 del servidor.
  const dim = src as unknown as { naturalWidth?: number; width?: number; naturalHeight?: number; height?: number }
  const fw = esVideo ? (src as HTMLVideoElement).videoWidth : (dim.naturalWidth || dim.width || 0)
  const fh = esVideo ? (src as HTMLVideoElement).videoHeight : (dim.naturalHeight || dim.height || 0)
  if (fw > 0 && fh > 0) {
    const escala = esVideo ? 1 : 1.0 + 0.07 * avance
    const rel = Math.max(w / fw, h / fh) * escala
    const iw = fw * rel
    const ih = fh * rel
    // Deriva vertical mínima: da vida sin que se note el movimiento.
    const dy = (h - ih) / 2 - (esVideo ? 0 : h * 0.015 * avance)
    ctx.drawImage(src, (w - iw) / 2, dy, iw, ih)
  }

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
  const finTitulo = Math.max(0, o.duracionAudio - CIERRE * 0.2)
  const tituloOut = 1 - suave((t - finTitulo) / 0.6)
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
