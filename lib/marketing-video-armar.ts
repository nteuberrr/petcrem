import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { uploadToR2 } from './cloudflare-r2'
import { bajarA, renderizarVideo } from './video-render-servidor'
import { duracionTotal, type FormatoVideo, type PalabraTiempo } from './video-marca'

/**
 * Arma el MP4 final a partir de las piezas ya generadas (fondo, locución,
 * música) y lo deja en R2. Es el paso que antes hacía el navegador.
 */

export interface ArmarVideoArgs {
  formato: FormatoVideo
  titulo: string
  guion: string
  palabras: PalabraTiempo[]
  duracion: number
  fondoUrl: string
  fondoTipo: 'imagen' | 'video'
  musicaUrl?: string
  locucionUrl: string
  nombre?: string
}

export interface VideoArmado {
  url: string
  key: string
  bytes: number
  segundos: number
}

export async function armarVideo(a: ArmarVideoArgs): Promise<VideoArmado> {
  const dir = mkdtempSync(join(tmpdir(), 'alma-armar-'))
  try {
    const extFondo = a.fondoTipo === 'video' ? 'mp4' : (a.fondoUrl.split('.').pop()?.split('?')[0] || 'jpg').slice(0, 4)
    const [fondoPath, vozPath, musicaPath] = await Promise.all([
      bajarA(a.fondoUrl, dir, `fondo.${extFondo}`),
      bajarA(a.locucionUrl, dir, 'voz.mp3'),
      a.musicaUrl ? bajarA(a.musicaUrl, dir, 'musica.mp3') : Promise.resolve(undefined),
    ])

    const mp4 = await renderizarVideo({
      formato: a.formato,
      titulo: a.titulo,
      palabras: a.palabras,
      duracionAudio: a.duracion,
      fondoPath,
      fondoTipo: a.fondoTipo,
      vozPath,
      musicaPath,
    })

    const slug = (a.nombre || a.titulo || 'video').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'video'
    const key = `marketing/videos/${Date.now()}-${slug}.mp4`
    const { url } = await uploadToR2(mp4, key, 'video/mp4')

    return { url, key, bytes: mp4.length, segundos: duracionTotal(a.duracion) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
