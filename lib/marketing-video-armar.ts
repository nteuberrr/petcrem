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
  /** Tomas del montaje, en orden. */
  tomas: Array<{ url: string; tipo: 'imagen' | 'video' }>
  musicaUrl?: string
  locucionUrl: string
  nombre?: string
}

export interface VideoArmado {
  /** URL directa en R2 (la usa el render y el guardado). */
  url: string
  /**
   * Link para COMPARTIR/descargar, por nuestro dominio. La URL de R2 (`r2.dev`)
   * la bloquean los adblockers: al dueño le decía "el sitio no está disponible"
   * aunque el archivo estuviera perfecto.
   */
  descarga_url: string
  key: string
  bytes: number
  segundos: number
}

/** Link de descarga por nuestro origen (esquiva el bloqueo de r2.dev). */
export function linkDescarga(urlR2: string): string {
  const base = (process.env.PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '').replace(/\/+$/, '')
  return `${base}/api/marketing/medio?descargar=1&u=${encodeURIComponent(urlR2)}`
}

export async function armarVideo(a: ArmarVideoArgs): Promise<VideoArmado> {
  const dir = mkdtempSync(join(tmpdir(), 'alma-armar-'))
  try {
    const [tomas, vozPath, musicaPath] = await Promise.all([
      Promise.all(a.tomas.map(async (t, i) => {
        const ext = t.tipo === 'video' ? 'mp4' : (t.url.split('.').pop()?.split('?')[0] || 'jpg').slice(0, 4)
        return { path: await bajarA(t.url, dir, `toma${i}.${ext}`), tipo: t.tipo }
      })),
      bajarA(a.locucionUrl, dir, 'voz.mp3'),
      a.musicaUrl ? bajarA(a.musicaUrl, dir, 'musica.mp3') : Promise.resolve(undefined),
    ])

    const mp4 = await renderizarVideo({
      formato: a.formato,
      titulo: a.titulo,
      palabras: a.palabras,
      duracionAudio: a.duracion,
      tomas,
      vozPath,
      musicaPath,
    })

    const slug = (a.nombre || a.titulo || 'video').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'video'
    const key = `marketing/videos/${Date.now()}-${slug}.mp4`
    const { url } = await uploadToR2(mp4, key, 'video/mp4')

    return { url, descarga_url: linkDescarga(url), key, bytes: mp4.length, segundos: duracionTotal(a.duracion) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
