import { spawn } from 'child_process'
import { createCanvas, GlobalFonts, loadImage, type Image } from '@napi-rs/canvas'
import ffmpegPath from 'ffmpeg-static'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { FORMATOS, dibujarCuadro, duracionTotal, type FormatoVideo, type PalabraTiempo } from './video-marca'

/**
 * Arma el MP4 EN EL SERVIDOR, para que el agente pueda entregar el video
 * terminado sin que nadie tenga que abrir una pestaña.
 *
 * La clave del diseño: dibuja con **la misma `dibujarCuadro`** que la vista
 * previa del navegador (@napi-rs/canvas da un contexto 2D real en Node). Así la
 * definición de la pieza vive en UN solo lugar y lo que se ve es lo que sale;
 * si fueran dos implementaciones, se separarían al primer ajuste.
 *
 * Los cuadros se escriben crudos al stdin de ffmpeg y salen codificados en
 * H.264 + AAC. No se guarda ninguna secuencia de PNG en disco.
 */

const FPS = 30

let fuentesListas = false
/** Inter es la tipografía de marca; el sitio usa Geist. Se registran una vez. */
function registrarFuentes() {
  if (fuentesListas) return
  const base = join(process.cwd(), 'public', 'sitio', 'assets')
  const bold = join(base, '68780d4f39586a806a378a11_Inter-Bold.woff')
  const semi = join(base, '68780d4f39586a806a378a3e_Inter-SemiBold.woff')
  if (existsSync(bold)) GlobalFonts.registerFromPath(bold, 'InterMarca')
  if (existsSync(semi)) GlobalFonts.registerFromPath(semi, 'InterMarca')
  fuentesListas = true
}

export interface SpecVideo {
  formato: FormatoVideo
  titulo: string
  palabras: PalabraTiempo[]
  duracionAudio: number
  /** Fondo: imagen o video, ya descargado a disco. */
  fondoPath: string
  fondoTipo: 'imagen' | 'video'
  /** Locución en disco (obligatoria: sin voz no hay pieza). */
  vozPath: string
  /** Cama musical en disco (opcional). */
  musicaPath?: string
}

/**
 * Expresión de volumen para ffmpeg a partir de puntos (segundo, volumen).
 * Interpola lineal entre puntos, igual que la automatización del navegador.
 */
function expresionVolumen(puntos: Array<[number, number]>): string {
  let expr = String(puntos[puntos.length - 1][1])
  for (let i = puntos.length - 1; i > 0; i--) {
    const [t0, v0] = puntos[i - 1]
    const [t1, v1] = puntos[i]
    const tramo = t1 <= t0
      ? String(v1)
      : `${v0}+(${v1 - v0})*(t-${t0})/${t1 - t0}`
    expr = `if(lt(t,${t1}),${tramo},${expr})`
  }
  return expr
}

/**
 * Curva de la música: entra sola, se agacha bajo la voz, vuelve a subir en el
 * cierre de marca y termina en fundido. Mismos valores que la vista previa.
 */
function curvaMusica(duracionVoz: number, total: number): string {
  const ALTO = 0.22, BAJO = 0.09
  const puntos: Array<[number, number]> = [
    [0, 0],
    [1.2, ALTO],
    [2.4, BAJO],
    [Math.max(2.6, duracionVoz - 0.3), BAJO],
    [duracionVoz + 0.6, ALTO],
    [Math.max(duracionVoz + 0.8, total - 1.1), ALTO],
    [total, 0],
  ]
  return expresionVolumen(puntos)
}

/** Corre ffmpeg y resuelve con su salida de error (para poder diagnosticar). */
function correrFfmpeg(
  args: string[],
  onStdin?: (w: NodeJS.WritableStream, abortado: () => boolean) => Promise<void>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const bin = String(ffmpegPath || '')
    if (!bin) return reject(new Error('ffmpeg-static no disponible'))
    const p = spawn(bin, args, { stdio: [onStdin ? 'pipe' : 'ignore', 'ignore', 'pipe'] })
    let err = ''
    let cerrado = false
    p.stderr?.on('data', d => { err += d.toString(); if (err.length > 12000) err = err.slice(-6000) })
    // Si ffmpeg aborta (argumentos malos, códec faltante), el pipe se rompe: sin
    // este handler el EPIPE tumba el proceso ANTES de que se pueda leer el
    // stderr, y el error real queda invisible.
    p.stdin?.on('error', () => { cerrado = true })
    p.on('error', reject)
    p.on('close', code => {
      cerrado = true
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg salió con código ${code}:\n${err.slice(-1500)}`))
    })
    const stdin = p.stdin
    if (onStdin && stdin) {
      onStdin(stdin, () => cerrado)
        .then(() => { if (!cerrado) stdin.end() })
        .catch(e => { if (!cerrado) { stdin.destroy(); reject(e) } })
    }
  })
}

/**
 * Extrae los cuadros de un video de fondo (Veo) a PNGs, para poder dibujarlos
 * en el canvas igual que una foto. Si el video es más corto que la pieza, el
 * último cuadro se repite (se devuelve la lista tal cual y se satura el índice).
 */
async function extraerCuadros(videoPath: string, dir: string, segundos: number): Promise<string[]> {
  await correrFfmpeg(['-y', '-i', videoPath, '-vf', `fps=${FPS}`, '-t', String(segundos), join(dir, 'f%05d.png')])
  return readdirSync(dir).filter(f => f.startsWith('f') && f.endsWith('.png')).sort().map(f => join(dir, f))
}

export async function renderizarVideo(spec: SpecVideo): Promise<Buffer> {
  registrarFuentes()
  const { w, h } = FORMATOS[spec.formato]
  const total = duracionTotal(spec.duracionAudio)
  const cuadros = Math.ceil(total * FPS)
  const dir = mkdtempSync(join(tmpdir(), 'alma-video-'))

  try {
    // ── Fondo ──────────────────────────────────────────────────────────────
    let imagenFija: Image | null = null
    let cuadrosFondo: string[] = []
    if (spec.fondoTipo === 'video') {
      const dirF = join(dir, 'fondo')
      mkdirSync(dirF, { recursive: true })
      cuadrosFondo = await extraerCuadros(spec.fondoPath, dirF, total)
      if (cuadrosFondo.length === 0) throw new Error('No pude extraer cuadros del video de fondo')
    } else {
      imagenFija = await loadImage(spec.fondoPath)
    }
    const logoPath = join(process.cwd(), 'public', 'brand', 'logo-alma-animal.png')
    const logo = existsSync(logoPath) ? await loadImage(logoPath) : null

    const cv = createCanvas(w, h)
    const ctx = cv.getContext('2d')

    // ── Audio ──────────────────────────────────────────────────────────────
    const args = [
      '-y',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-r', String(FPS), '-i', 'pipe:0',
      '-i', spec.vozPath,
    ]
    if (spec.musicaPath) args.push('-stream_loop', '-1', '-i', spec.musicaPath)

    if (spec.musicaPath) {
      // normalize=0: sin eso, amix baja la voz al mezclar y se pierde la mezcla fina.
      // duration=longest: la música sigue sonando en el cierre, cuando la voz ya terminó.
      args.push('-filter_complex',
        `[2:a]volume='${curvaMusica(spec.duracionAudio, total)}':eval=frame[m];[1:a][m]amix=inputs=2:duration=longest:normalize=0[a]`,
        '-map', '0:v', '-map', '[a]')
    } else {
      args.push('-map', '0:v', '-map', '1:a')
    }

    const salida = join(dir, 'video.mp4')
    args.push(
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
      '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.0',
      // Estéreo explícito: la locución viene mono y sin esto el MP4 sale mono.
      '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2',
      '-movflags', '+faststart',       // que empiece a reproducir sin bajar todo
      // La duración la fija -t. NADA de -shortest: la voz termina antes que el
      // video y cortaba el cierre de marca (el logo no llegaba a verse).
      '-t', total.toFixed(3),
      salida,
    )

    // ── Cuadros ────────────────────────────────────────────────────────────
    await correrFfmpeg(args, async (stdin, abortado) => {
      for (let i = 0; i < cuadros; i++) {
        if (abortado()) return
        const t = i / FPS
        if (cuadrosFondo.length) {
          const idx = Math.min(cuadrosFondo.length - 1, i)
          imagenFija = await loadImage(cuadrosFondo[idx])
        }
        dibujarCuadro(ctx as unknown as CanvasRenderingContext2D, {
          formato: spec.formato,
          fondo: { tipo: 'imagen', el: imagenFija as unknown as HTMLImageElement },
          logo: logo as unknown as HTMLImageElement | null,
          titulo: spec.titulo,
          palabras: spec.palabras,
          duracionAudio: spec.duracionAudio,
          fuente: 'InterMarca, sans-serif',
        }, t)
        const datos = ctx.getImageData(0, 0, w, h).data
        const buf = Buffer.from(datos.buffer, datos.byteOffset, datos.byteLength)
        if (!stdin.write(buf)) {
          await new Promise<void>(res => stdin.once('drain', () => res()))
        }
      }
    })

    return readFileSync(salida)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Baja una URL a un archivo temporal (los medios viven en R2). */
export async function bajarA(url: string, dir: string, nombre: string): Promise<string> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`No pude descargar ${nombre} (${r.status})`)
  const p = join(dir, nombre)
  writeFileSync(p, Buffer.from(await r.arrayBuffer()))
  return p
}
