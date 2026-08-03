'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Film, Images, Loader2, Mic, Music, Sparkles, Video } from 'lucide-react'
import { Card, Button } from '@/components/ui/kit'
import {
  FORMATOS, dibujarCuadro, duracionTotal, formatoGrabacion,
  type Fondo, type FormatoVideo, type PalabraTiempo,
} from '@/lib/video-marca'

/**
 * Armador de VIDEO de marca: fondo (foto del banco o video de Veo) + locución
 * de ElevenLabs + subtítulos sincronizados + cierre de marca → MP4 descargable.
 *
 * El MP4 se arma EN EL NAVEGADOR (canvas + MediaRecorder). Ver el porqué en
 * lib/video-marca.ts. Como la grabación es en tiempo real, un video de 30 s
 * tarda 30 s en armarse: se avisa en pantalla.
 */

type ImagenBanco = { id: string; url: string; descripcion?: string; grupo?: string; codigo?: string }
type VideoBanco = { id: string; url: string; descripcion?: string; codigo?: string; aspect?: string }
type Voz = { id: string; nombre: string; describe: string }
type VideoPendiente = {
  id: string; tema: string; titulo: string; guion: string
  locucion_url: string; duracion: number; palabras: PalabraTiempo[]
  musica_url: string; clima: string
  fondo_url: string; fondo_tipo: 'imagen' | 'video'; fondo_codigo: string; fondo_grupo: string
  formato: FormatoVideo; creado: string
  /** MP4 ya armado por el servidor (vacío si hay que armarlo acá). */
  video_url?: string
}

/** Todo lo que vive en R2 se pide por nuestro origen: si no, el canvas queda
 *  "sucio" y no se puede grabar (y además los adblockers filtran r2.dev). */
const porNuestroOrigen = (url: string) => `/api/marketing/medio?u=${encodeURIComponent(url)}`
/** Igual, pero forzando la descarga (el `download` de un <a> no cruza origen). */
const paraDescargar = (url: string) => `/api/marketing/medio?descargar=1&u=${encodeURIComponent(url)}`

const FUENTE = "'InterMarca', var(--font-geist-sans), system-ui, sans-serif"

/** Categorías del banco (la columna `grupo` de mailing_imagenes). */
const GRUPOS: { key: string; label: string }[] = [
  { key: '', label: 'Todas' },
  { key: 'instalaciones', label: 'Instalaciones' },
  { key: 'mascotas', label: 'Mascotas' },
  { key: 'personas', label: 'Personas' },
  { key: 'productos', label: 'Productos' },
  { key: 'marca', label: 'Marca' },
  { key: 'otro', label: 'Otras' },
]

export default function VideoPanel() {
  const [imagenes, setImagenes] = useState<ImagenBanco[]>([])
  const [videos, setVideos] = useState<VideoBanco[]>([])
  const [voces, setVoces] = useState<Voz[]>([])
  const [vozSel, setVozSel] = useState('')
  const [sinLocucion, setSinLocucion] = useState(false)

  const [grupo, setGrupo] = useState('')
  const [fondoSel, setFondoSel] = useState<{ tipo: 'imagen' | 'video'; url: string } | null>(null)
  const [formato, setFormato] = useState<FormatoVideo>('reel')
  const [tema, setTema] = useState('')
  const [segundos, setSegundos] = useState(28)
  const [titulo, setTitulo] = useState('')
  const [guion, setGuion] = useState('')
  const [avisos, setAvisos] = useState<string[]>([])

  const [audio, setAudio] = useState<{ url: string; palabras: PalabraTiempo[]; duracion: number } | null>(null)
  const [climas, setClimas] = useState<{ key: string; label: string; describe: string }[]>([])
  const [climaSel, setClimaSel] = useState('tierna')
  const [musica, setMusica] = useState<{ url: string; reusada: boolean } | null>(null)
  const [musicando, setMusicando] = useState(false)
  const [pendientes, setPendientes] = useState<VideoPendiente[]>([])
  const [escribiendo, setEscribiendo] = useState(false)
  const [locutando, setLocutando] = useState(false)
  const [grabando, setGrabando] = useState(false)
  const [progreso, setProgreso] = useState(0)
  const [error, setError] = useState('')
  // `url` para el <video> de la vista, `descarga` para el botón (fuerza el guardado).
  const [listo, setListo] = useState<{ url: string; descarga?: string; ext: string; esMp4: boolean } | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fondoRef = useRef<Fondo | null>(null)
  // Ref aparte para CONTROLAR la reproducción del fondo cuando es video (el
  // compilador de React no deja mutar algo sacado de una unión en un ref).
  const fondoVideoRef = useRef<HTMLVideoElement | null>(null)
  // El logo y el fondo van en estado (no solo en ref) para que al terminar de
  // cargarse se vuelva a pintar la vista previa.
  const [logo, setLogo] = useState<HTMLImageElement | null>(null)
  const [fondoListo, setFondoListo] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const musicaRef = useRef<HTMLAudioElement | null>(null)
  const musicaGainRef = useRef<GainNode | null>(null)
  const ctxAudioRef = useRef<{ ctx: AudioContext; dest: MediaStreamAudioDestinationNode } | null>(null)
  // createMediaElementSource solo se puede llamar UNA vez por elemento.
  const audioConectadoRef = useRef(false)
  const rafRef = useRef<number | null>(null)

  // ── Carga inicial: bancos, voces y tipografía de marca ────────────────────
  useEffect(() => {
    fetch('/api/mailing/imagenes', { cache: 'no-store' })
      .then(r => r.json()).then(d => setImagenes(Array.isArray(d) ? d : [])).catch(() => {})
    fetch('/api/mailing/videos', { cache: 'no-store' })
      .then(r => r.json()).then(d => setVideos(Array.isArray(d) ? d : [])).catch(() => {})
    fetch('/api/marketing/locucion', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        setVoces(d.voces || [])
        setVozSel(d.por_defecto || (d.voces?.[0]?.id ?? ''))
        setSinLocucion(!d.configurado)
      }).catch(() => {})
    fetch('/api/marketing/musica', { cache: 'no-store' })
      .then(r => r.json()).then(d => setClimas(d.climas || [])).catch(() => {})
    cargarPendientes()

    // Inter es la tipografía de marca (la de los correos y el certificado); la
    // del sitio es Geist. Se carga desde public/ para que el canvas no dependa
    // de un recurso externo.
    const cargar = async () => {
      try {
        const bold = new FontFace('InterMarca', 'url(/sitio/assets/68780d4f39586a806a378a11_Inter-Bold.woff)', { weight: '700' })
        const semi = new FontFace('InterMarca', 'url(/sitio/assets/68780d4f39586a806a378a3e_Inter-SemiBold.woff)', { weight: '600' })
        const cargadas = await Promise.all([bold.load(), semi.load()])
        cargadas.forEach(f => document.fonts.add(f))
      } catch { /* cae a la tipografía del sitio */ }
    }
    cargar()

    const img = new Image()
    img.src = '/brand/logo-alma-animal.png'
    img.onload = () => setLogo(img)
  }, [])

  // ── Bandeja: videos que el agente dejó preparados ────────────────────────
  function cargarPendientes() {
    fetch('/api/marketing/videos-pendientes', { cache: 'no-store' })
      .then(r => r.json()).then(d => setPendientes(Array.isArray(d) ? d : [])).catch(() => {})
  }

  /** Carga un preparado del agente en el armador: queda todo listo para grabar. */
  function abrirPendiente(p: VideoPendiente) {
    setTema(p.tema)
    setTitulo(p.titulo)
    setGuion(p.guion)
    setFormato(p.formato)
    setAudio({ url: p.locucion_url, palabras: p.palabras || [], duracion: p.duracion })
    setMusica(p.musica_url ? { url: p.musica_url, reusada: true } : null)
    setClimaSel(p.clima || 'tierna')
    setFondoSel({ tipo: p.fondo_tipo, url: p.fondo_url })
    setAvisos([])
    setListo(null)
    // Se rearman los elementos de audio con las pistas nuevas.
    audioRef.current = null
    audioConectadoRef.current = false
    musicaRef.current = null
    musicaGainRef.current = null
  }

  async function descartarPendiente(id: string) {
    await fetch(`/api/marketing/videos-pendientes?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {})
    cargarPendientes()
  }

  /** Dibuja el cuadro del segundo `t` (vista previa y grabación usan lo mismo). */
  const pintar = useCallback((t: number) => {
    const cv = canvasRef.current
    const f = fondoRef.current
    if (!cv || !f) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    dibujarCuadro(ctx, {
      formato,
      fondo: f,
      logo,
      titulo,
      palabras: audio?.palabras || [],
      duracionAudio: audio?.duracion || Math.max(6, segundos),
      fuente: FUENTE,
    }, t)
  }, [formato, titulo, audio, segundos, logo])

  // Repinta cuando cambia algo que se ve: fondo cargado, formato, título, voz…
  useEffect(() => { pintar(0.8) }, [pintar, fondoListo])

  // ── Cargar el fondo elegido ───────────────────────────────────────────────
  useEffect(() => {
    if (!fondoSel) { fondoRef.current = null; fondoVideoRef.current = null; return }
    let cancelado = false
    const url = porNuestroOrigen(fondoSel.url)
    if (fondoSel.tipo === 'imagen') {
      const img = new Image()
      img.onload = () => {
        if (cancelado) return
        fondoRef.current = { tipo: 'imagen', el: img }
        fondoVideoRef.current = null
        setFondoListo(n => n + 1)
      }
      img.onerror = () => setError('No se pudo cargar la imagen elegida.')
      img.src = url
    } else {
      const v = document.createElement('video')
      v.src = url
      v.muted = true
      v.loop = true
      v.playsInline = true
      v.onloadeddata = () => {
        if (cancelado) return
        fondoRef.current = { tipo: 'video', el: v }
        fondoVideoRef.current = v
        void v.play().catch(() => {})
        setFondoListo(n => n + 1)
      }
      v.onerror = () => setError('No se pudo cargar el video elegido.')
    }
    return () => { cancelado = true }
  }, [fondoSel])

  // ── Guion ────────────────────────────────────────────────────────────────
  async function escribirGuion() {
    if (!tema.trim() || escribiendo) return
    setEscribiendo(true); setError(''); setAvisos([])
    try {
      const r = await fetch('/api/marketing/guion', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tema, segundos }),
      })
      const j = await r.json()
      if (!r.ok) { setError(j.error || 'No se pudo escribir el guion'); return }
      setGuion(j.guion); setTitulo(j.titulo); setAvisos(j.avisos || [])
      setAudio(null); setListo(null)
    } catch { setError('Error de red al escribir el guion') } finally { setEscribiendo(false) }
  }

  // ── Locución ─────────────────────────────────────────────────────────────
  async function generarLocucion() {
    if (!guion.trim() || locutando) return
    setLocutando(true); setError('')
    try {
      const r = await fetch('/api/marketing/locucion', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: guion, voz: vozSel }),
      })
      const j = await r.json()
      if (!r.ok) { setError(j.error || 'No se pudo generar la locución'); return }
      setAudio({ url: j.url, palabras: j.palabras || [], duracion: j.duracion || 0 })
      setListo(null)
      // El <audio> se rearma con la pista nueva (y hay que volver a conectarlo).
      audioRef.current = null
      audioConectadoRef.current = false
    } catch { setError('Error de red al generar la locución') } finally { setLocutando(false) }
  }

  // ── Música ───────────────────────────────────────────────────────────────
  async function generarMusicaFondo(regenerar = false) {
    if (musicando) return
    setMusicando(true); setError('')
    try {
      const r = await fetch('/api/marketing/musica', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clima: climaSel, segundos: Math.ceil(duracionTotal(audio?.duracion || segundos)), regenerar }),
      })
      const j = await r.json()
      if (!r.ok) { setError(j.error || 'No se pudo generar la música'); return }
      setMusica({ url: j.url, reusada: !!j.reusada })
      musicaRef.current = null
      musicaGainRef.current = null
      setListo(null)
    } catch { setError('Error de red al generar la música') } finally { setMusicando(false) }
  }

  function quitarMusica() {
    setMusica(null)
    musicaRef.current = null
    musicaGainRef.current = null
    setListo(null)
  }

  /** Prepara (una sola vez) el <audio> y su ruteo hacia la grabación. */
  function prepararAudio(): HTMLAudioElement | null {
    if (!audio) return null
    if (audioRef.current) return audioRef.current
    const el = new Audio(porNuestroOrigen(audio.url))
    el.crossOrigin = 'anonymous'
    el.preload = 'auto'
    audioRef.current = el
    return el
  }

  function prepararMusica(): HTMLAudioElement | null {
    if (!musica) return null
    if (musicaRef.current) return musicaRef.current
    const el = new Audio(porNuestroOrigen(musica.url))
    el.crossOrigin = 'anonymous'
    el.preload = 'auto'
    el.loop = true // si la cama es más corta que la pieza, se repite
    musicaRef.current = el
    return el
  }

  /**
   * Volumen de la música a lo largo de la pieza. La voz manda: la cama entra
   * sola, se agacha mientras se habla y vuelve a subir en el cierre de marca,
   * cerrando con un fundido. Programado por adelantado en el WebAudio para que
   * la mezcla salga igual en cada grabación.
   */
  function programarVolumenMusica(ctx: AudioContext, gain: GainNode, duracionVoz: number, total: number) {
    const t0 = ctx.currentTime
    const ALTO = 0.22   // sin voz encima
    const BAJO = 0.09   // debajo de la voz
    gain.gain.cancelScheduledValues(t0)
    gain.gain.setValueAtTime(0, t0)
    gain.gain.linearRampToValueAtTime(ALTO, t0 + 1.2)              // entra
    gain.gain.setValueAtTime(ALTO, t0 + Math.max(1.2, 1.6))
    gain.gain.linearRampToValueAtTime(BAJO, t0 + 2.4)              // se agacha para la voz
    gain.gain.setValueAtTime(BAJO, t0 + Math.max(2.5, duracionVoz - 0.3))
    gain.gain.linearRampToValueAtTime(ALTO, t0 + duracionVoz + 0.6) // cierre de marca
    gain.gain.setValueAtTime(ALTO, t0 + Math.max(duracionVoz + 0.7, total - 1.1))
    gain.gain.linearRampToValueAtTime(0, t0 + total)                // fundido final
  }

  // ── Vista previa en vivo ─────────────────────────────────────────────────
  function reproducir() {
    const el = prepararAudio()
    const mus = prepararMusica()
    const total = duracionTotal(audio?.duracion || segundos)
    const t0 = performance.now()
    if (el) { el.currentTime = 0; void el.play().catch(() => {}) }
    // En la vista previa la música va a volumen fijo bajo (la mezcla fina se
    // programa recién al grabar, donde importa que quede clavada).
    if (mus) { mus.currentTime = 0; mus.volume = 0.14; void mus.play().catch(() => {}) }
    const paso = () => {
      const t = (performance.now() - t0) / 1000
      pintar(t)
      if (t < total) rafRef.current = requestAnimationFrame(paso)
      else { pintar(0.8); if (el) el.pause(); if (mus) mus.pause() }
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(paso)
  }

  /**
   * Camino por defecto: lo arma el SERVIDOR (mismo dibujo, mejor calidad y sin
   * depender del navegador). Si falla, queda el armado local de abajo.
   */
  async function armarEnServidor() {
    if (!fondoSel || !audio || grabando) return
    setGrabando(true); setError(''); setListo(null); setProgreso(0)
    try {
      const r = await fetch('/api/marketing/video', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formato, titulo, guion,
          palabras: audio.palabras, duracion: audio.duracion,
          fondo_url: fondoSel.url, fondo_tipo: fondoSel.tipo,
          musica_url: musica?.url || '', locucion_url: audio.url,
        }),
      })
      const j = await r.json()
      if (!r.ok) { setError(`${j.error || 'No se pudo armar en el servidor'} — probá "Armar acá".`); return }
      setListo({ url: porNuestroOrigen(j.url), descarga: paraDescargar(j.url), ext: 'mp4', esMp4: true })
    } catch {
      setError('Error de red al armar el video en el servidor — probá "Armar acá".')
    } finally { setGrabando(false) }
  }

  // ── Armado del MP4 en el navegador (respaldo) ────────────────────────────
  async function armarVideo() {
    const cv = canvasRef.current
    if (!cv || !fondoRef.current || grabando) return
    const fmt = formatoGrabacion()
    if (!fmt) { setError('Este navegador no puede grabar video. Usa Chrome o Edge.'); return }

    setGrabando(true); setError(''); setListo(null); setProgreso(0)
    try {
      const total = duracionTotal(audio?.duracion || segundos)
      const streamVideo = cv.captureStream(30)
      const pistas = [...streamVideo.getVideoTracks()]

      // Voz y música se rutean por WebAudio para mezclarlas en la grabación.
      const el = prepararAudio()
      const mus = prepararMusica()
      if (el || mus) {
        if (!ctxAudioRef.current) {
          const ctx = new AudioContext()
          const dest = ctx.createMediaStreamDestination()
          ctxAudioRef.current = { ctx, dest }
        }
        const { ctx, dest } = ctxAudioRef.current
        if (el && !audioConectadoRef.current) {
          const src = ctx.createMediaElementSource(el)
          src.connect(dest)
          src.connect(ctx.destination) // que además se escuche mientras se arma
          audioConectadoRef.current = true
        }
        if (mus && !musicaGainRef.current) {
          const src = ctx.createMediaElementSource(mus)
          const gain = ctx.createGain()
          gain.gain.value = 0
          src.connect(gain)
          gain.connect(dest)
          gain.connect(ctx.destination)
          musicaGainRef.current = gain
        }
        await ctx.resume().catch(() => {})
        pistas.push(...dest.stream.getAudioTracks())
      }

      const rec = new MediaRecorder(new MediaStream(pistas), {
        mimeType: fmt.mime,
        videoBitsPerSecond: 8_000_000,
        audioBitsPerSecond: 128_000,
      })
      const trozos: Blob[] = []
      rec.ondataavailable = e => { if (e.data.size) trozos.push(e.data) }
      const terminado = new Promise<void>(res => { rec.onstop = () => res() })

      rec.start(250)
      if (mus && ctxAudioRef.current && musicaGainRef.current) {
        programarVolumenMusica(ctxAudioRef.current.ctx, musicaGainRef.current, audio?.duracion || segundos, total)
        mus.currentTime = 0
        await mus.play().catch(() => {})
      }
      if (el) { el.currentTime = 0; await el.play().catch(() => {}) }
      const fondoVid = fondoVideoRef.current
      if (fondoVid) { fondoVid.currentTime = 0; void fondoVid.play().catch(() => {}) }

      // La grabación es en tiempo real: se dibuja contra el reloj, no contra
      // un contador de cuadros, para que audio y video no se desfasen.
      const t0 = performance.now()
      await new Promise<void>(res => {
        const paso = () => {
          const t = (performance.now() - t0) / 1000
          pintar(t)
          setProgreso(Math.min(100, Math.round((t / total) * 100)))
          if (t < total) rafRef.current = requestAnimationFrame(paso)
          else res()
        }
        rafRef.current = requestAnimationFrame(paso)
      })

      rec.stop()
      if (el) el.pause()
      if (mus) mus.pause()
      if (fondoVid) fondoVid.pause()
      await terminado

      const blob = new Blob(trozos, { type: fmt.mime })
      setListo({ url: URL.createObjectURL(blob), ext: fmt.ext, esMp4: fmt.esMp4 })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo armar el video')
    } finally { setGrabando(false); setProgreso(0) }
  }

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  const dims = FORMATOS[formato]
  const puedeArmar = !!fondoSel && !!guion.trim() && !grabando
  const imagenesFiltradas = grupo ? imagenes.filter(i => (i.grupo || 'otro') === grupo) : imagenes

  return (
    <div className="space-y-4">
      {sinLocucion && (
        <Card className="border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Falta <code>ELEVENLABS_API_KEY</code>: se puede armar el video, pero sin voz ni subtítulos.
        </Card>
      )}
      {error && <Card className="border-red-300 bg-red-50 p-4 text-sm text-red-700">{error}</Card>}

      {/* Bandeja del agente: pedís el video en el chat y acá aparece listo. */}
      {pendientes.length > 0 && (
        <Card className="border-gold/60 bg-gold/5 p-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-brand">
            <Sparkles className="h-4 w-4 text-gold" aria-hidden="true" />
            El agente dejó {pendientes.length} {pendientes.length === 1 ? 'video preparado' : 'videos preparados'}
          </h3>
          <ul className="space-y-2">
            {pendientes.map(p => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-gray-900">{p.titulo || p.tema}</span>
                  <span className="block truncate text-[11px] text-gray-500">
                    {p.duracion.toFixed(0)} s · fondo {p.fondo_codigo} ({p.fondo_grupo}) · {p.clima || 'sin música'} · {FORMATOS[p.formato]?.label || p.formato}
                  </span>
                </span>
                {p.video_url ? (
                  // El servidor ya lo armó: se descarga y listo.
                  <a href={paraDescargar(p.video_url)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
                    <Download className="h-4 w-4" aria-hidden="true" /> Descargar MP4
                  </a>
                ) : (
                  <span className="rounded-lg bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-800">Falta armarlo</span>
                )}
                <Button type="button" variant="secondary" onClick={() => abrirPendiente(p)}>Abrir</Button>
                <button type="button" onClick={() => descartarPendiente(p.id)}
                  className="text-xs font-semibold text-red-600 hover:underline">Descartar</button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* min-w-0 en las columnas: sin eso, las tiras horizontales de imágenes
          (overflow-x-auto) fuerzan el ancho de su columna y estiran la página
          entera — es el comportamiento por defecto de los hijos de un grid. */}
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* ── Columna de trabajo ── */}
        <div className="min-w-0 space-y-4">
          {/* 1. Fondo */}
          <Card className="p-4">
            <h3 className="mb-1 text-sm font-bold text-brand">1 · Fondo</h3>
            <p className="mb-3 text-xs text-gray-600">Una foto del banco (se le aplica un zoom lento) o un video ya generado con Veo.</p>

            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                <Images className="h-3.5 w-3.5" aria-hidden="true" /> Imágenes
              </p>
              <div className="flex flex-wrap gap-1">
                {GRUPOS.map(g => {
                  const n = g.key === '' ? imagenes.length : imagenes.filter(i => (i.grupo || 'otro') === g.key).length
                  return (
                    <button key={g.key || 'todas'} type="button" onClick={() => setGrupo(g.key)}
                      className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${
                        grupo === g.key ? 'bg-brand text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}>
                      {g.label}{n > 0 && <span className="ml-1 opacity-70">{n}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
              {imagenesFiltradas.slice(0, 60).map(i => (
                <button key={i.id} type="button" onClick={() => { setFondoSel({ tipo: 'imagen', url: i.url }); setListo(null) }}
                  title={i.descripcion || i.codigo}
                  className={`h-20 w-20 shrink-0 overflow-hidden rounded-lg border-2 transition-all ${fondoSel?.url === i.url ? 'border-gold ring-2 ring-gold/40' : 'border-gray-300 hover:border-brand'}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={porNuestroOrigen(i.url)} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
              {imagenesFiltradas.length === 0 && (
                <p className="text-xs text-gray-400">
                  {imagenes.length === 0 ? 'El banco de imágenes está vacío.' : 'No hay imágenes en esta categoría.'}
                </p>
              )}
            </div>

            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              <Video className="h-3.5 w-3.5" aria-hidden="true" /> Videos
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {videos.slice(0, 24).map(v => (
                <button key={v.id} type="button" onClick={() => { setFondoSel({ tipo: 'video', url: v.url }); setListo(null) }}
                  title={v.descripcion || v.codigo}
                  className={`flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 bg-gray-900 text-white transition-all ${fondoSel?.url === v.url ? 'border-gold ring-2 ring-gold/40' : 'border-gray-300 hover:border-brand'}`}>
                  <Film className="h-6 w-6" aria-hidden="true" />
                </button>
              ))}
              {videos.length === 0 && <p className="text-xs text-gray-400">Todavía no hay videos generados.</p>}
            </div>
          </Card>

          {/* 2. Guion */}
          <Card className="p-4">
            <h3 className="mb-1 text-sm font-bold text-brand">2 · Guion</h3>
            <p className="mb-3 text-xs text-gray-600">Un guion se escucha, no se lee: frases cortas, sin listas ni emojis, con los números en palabras.</p>
            <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_110px_auto]">
              <input value={tema} onChange={e => setTema(e.target.value)}
                placeholder="Tema del video (ej.: por qué la trazabilidad importa)"
                className="rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:ring-2 focus:ring-brand outline-none" />
              <select value={segundos} onChange={e => setSegundos(Number(e.target.value))}
                className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
                {[15, 20, 28, 35, 45].map(s => <option key={s} value={s}>{s} s</option>)}
              </select>
              <Button type="button" variant="secondary" onClick={escribirGuion} disabled={!tema.trim() || escribiendo}>
                {escribiendo ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
                <span className="ml-1.5">{escribiendo ? 'Escribiendo…' : 'Escribir con el agente'}</span>
              </Button>
            </div>
            <input value={titulo} onChange={e => setTitulo(e.target.value)} maxLength={38}
              placeholder="Título en pantalla (máx. 38 caracteres)"
              className="mb-2 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm font-semibold focus:border-brand focus:ring-2 focus:ring-brand outline-none" />
            <textarea value={guion} onChange={e => { setGuion(e.target.value); setAudio(null); setListo(null) }} rows={5}
              placeholder="Lo que dice la voz…"
              className="w-full resize-y rounded-xl border border-gray-300 px-3 py-2 text-sm leading-relaxed focus:border-brand focus:ring-2 focus:ring-brand outline-none" />
            {avisos.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-[11px] text-amber-800">
                {avisos.map(a => <li key={a}>· {a}</li>)}
              </ul>
            )}
          </Card>

          {/* 3. Voz */}
          <Card className="p-4">
            <h3 className="mb-1 text-sm font-bold text-brand">3 · Locución</h3>
            <p className="mb-3 text-xs text-gray-600">De acá salen los subtítulos sincronizados: en Instagram y Facebook la mayoría mira sin sonido.</p>
            <div className="flex flex-wrap items-center gap-2">
              <select value={vozSel} onChange={e => setVozSel(e.target.value)}
                className="min-w-0 flex-1 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
                {voces.map(v => <option key={v.id} value={v.id}>{v.nombre} — {v.describe}</option>)}
              </select>
              <Button type="button" variant="secondary" onClick={generarLocucion} disabled={!guion.trim() || locutando || sinLocucion}>
                {locutando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Mic className="h-4 w-4" aria-hidden="true" />}
                <span className="ml-1.5">{locutando ? 'Generando…' : 'Generar locución'}</span>
              </Button>
            </div>
            {audio && (
              <div className="mt-3">
                <audio controls src={porNuestroOrigen(audio.url)} className="w-full" />
                <p className="mt-1 text-[11px] text-gray-500">{audio.duracion.toFixed(1)} s de voz · el video dura {duracionTotal(audio.duracion).toFixed(1)} s con el cierre de marca.</p>
              </div>
            )}
          </Card>

          {/* 4. Música */}
          <Card className="p-4">
            <h3 className="mb-1 text-sm font-bold text-brand">4 · Música de fondo</h3>
            <p className="mb-3 text-xs text-gray-600">
              Generada con licencia comercial (se puede pautar sin riesgo). Va por debajo de la voz y sube
              sola en el cierre. Es una cama, no una canción: sin percusión ni crescendo.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select value={climaSel} onChange={e => { setClimaSel(e.target.value); quitarMusica() }}
                className="min-w-0 flex-1 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
                {climas.map(c => <option key={c.key} value={c.key}>{c.label} — {c.describe}</option>)}
              </select>
              <Button type="button" variant="secondary" onClick={() => generarMusicaFondo(false)} disabled={musicando || sinLocucion}>
                {musicando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Music className="h-4 w-4" aria-hidden="true" />}
                <span className="ml-1.5">{musicando ? 'Generando…' : 'Poner música'}</span>
              </Button>
            </div>
            {musica && (
              <div className="mt-3">
                <audio controls src={porNuestroOrigen(musica.url)} className="w-full" />
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-gray-500">
                    {musica.reusada ? 'Reusada: el mismo clima suena igual en todas las piezas.' : 'Cama nueva, guardada para las próximas piezas.'}
                  </p>
                  <span className="flex gap-3 text-[11px]">
                    <button type="button" onClick={() => generarMusicaFondo(true)} className="font-semibold text-brand-soft hover:underline">Otra versión</button>
                    <button type="button" onClick={quitarMusica} className="font-semibold text-red-600 hover:underline">Quitar</button>
                  </span>
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* ── Vista previa ── */}
        <div className="min-w-0 space-y-3">
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-brand">Vista previa</h3>
              <select value={formato} onChange={e => { setFormato(e.target.value as FormatoVideo); setListo(null) }}
                className="rounded-xl border border-gray-300 bg-white px-2 py-1 text-xs">
                {Object.entries(FORMATOS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
              </select>
            </div>

            <div className="flex justify-center rounded-xl bg-slate-900 p-3">
              <canvas ref={canvasRef} width={dims.w} height={dims.h}
                className="max-h-[420px] w-auto rounded-lg shadow-md"
                style={{ aspectRatio: `${dims.w} / ${dims.h}` }} />
            </div>

            {!fondoSel && <p className="mt-2 text-center text-xs text-gray-500">Elige un fondo para ver la pieza.</p>}

            <div className="mt-3 flex gap-2">
              <Button type="button" variant="ghost" onClick={reproducir} disabled={!fondoSel || grabando}>
                Reproducir
              </Button>
              <Button type="button" onClick={armarEnServidor} disabled={!puedeArmar || !audio} className="flex-1">
                {grabando ? 'Armando…' : 'Armar video'}
              </Button>
            </div>
            <button type="button" onClick={armarVideo} disabled={!puedeArmar}
              className="mt-2 w-full text-[11px] font-medium text-gray-500 hover:text-brand disabled:opacity-40">
              {grabando && progreso > 0 ? `Armando en el navegador… ${progreso}%` : 'o armarlo acá, en el navegador (respaldo)'}
            </button>
            {grabando && (
              <p className="mt-2 text-center text-[11px] text-gray-500">
                {progreso > 0
                  ? 'Se graba en tiempo real: tarda lo que dura el video. No cambies de pestaña.'
                  : 'Codificando en el servidor: alrededor de un minuto.'}
              </p>
            )}

            {listo && (
              <div className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 p-3">
                <video src={listo.url} controls className="mb-2 w-full rounded-lg" />
                <a href={listo.descarga || listo.url} download={`alma-animal-${formato}.${listo.ext}`}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
                  <Download className="h-4 w-4" aria-hidden="true" /> Descargar .{listo.ext}
                </a>
                {!listo.esMp4 && (
                  <p className="mt-2 text-[11px] text-amber-800">
                    Tu navegador solo pudo grabar en WebM, que Instagram no acepta. Ármalo desde Chrome o Edge para obtener MP4.
                  </p>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
