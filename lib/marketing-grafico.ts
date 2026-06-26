import sharp from 'sharp'
import { renderGraficoHTML } from './grafico-render'
import { generarYGuardarImagen, listarImagenes, registrarImagen } from './mailing-images'
import { aplicarLogoMarca, esLogo } from './marca-logo'
import { uploadToR2 } from './cloudflare-r2'
import { isNanoBananaConfigurado } from './nano-banana'

/**
 * Genera una PIEZA GRÁFICA de marca (portada, placa, anuncio) con la marca EXACTA.
 *
 * El agente diseña en HTML (libre, incluido DÓNDE va el logo); acá: 1) generamos las
 * fotos pedidas y las enchufamos, 2) rasterizamos con las fuentes/colores REALES
 * (satori), 3) si el agente NO puso el logo, lo estampamos como respaldo, 4) subimos
 * a R2 + banco. Así el diseño es creativo pero la marca (color/tipografía/logo) es exacta.
 */

const DIMS: Record<string, { w: number; h: number }> = {
  portada_fb: { w: 1640, h: 624 },   // portada de Facebook (~820x312 ×2)
  post: { w: 1080, h: 1080 },        // feed cuadrado
  post_vertical: { w: 1080, h: 1350 }, // feed 4:5
  story: { w: 1080, h: 1920 },       // story / reel 9:16
  horizontal: { w: 1200, h: 675 },   // 16:9 (web/anuncio)
}
export const FORMATOS_GRAFICO = Object.keys(DIMS)

export interface FotoGrafico { slot: string; prompt: string; aspect?: string }

export interface GraficoGenerado {
  url: string
  /** Fotos generadas (slot → URL) para que el agente las REUSE si solo ajusta el texto. */
  fotos: { slot: string; url: string }[]
  avisos: string[]
}

export async function generarGraficoMarca(args: {
  formato: string
  html: string
  fotos?: FotoGrafico[]
  creadoPor?: string
}): Promise<GraficoGenerado> {
  if (!args.html?.trim()) throw new Error('Falta el HTML del gráfico')
  const dims = DIMS[args.formato] || DIMS.post
  const avisos: string[] = []
  let html = args.html

  // 1) Generar las fotos pedidas (fotorrealistas, on-brand) y enchufarlas (FOTO:slot → URL).
  const fotos = (args.fotos || []).filter(f => f?.slot && f?.prompt)
  const fotosUsadas: { slot: string; url: string }[] = []
  if (fotos.length && !isNanoBananaConfigurado()) {
    avisos.push('No se pudieron generar las fotos (falta GEMINI_API_KEY); el gráfico va sin ellas.')
  } else {
    for (const f of fotos) {
      try {
        const g = await generarYGuardarImagen({
          prompt: f.prompt, aspect: f.aspect || '4:5', grupo: 'mascotas', subgrupo: 'grafico', creadoPor: args.creadoPor,
        })
        html = html.split(`FOTO:${f.slot}`).join(g.imagen.url)
        fotosUsadas.push({ slot: f.slot, url: g.imagen.url })
      } catch (e) {
        avisos.push(`No se pudo generar la foto ${f.slot}: ${e instanceof Error ? e.message : 'error'}`)
      }
    }
  }
  // Limpiar placeholders FOTO: que hayan quedado sin resolver (evita src roto).
  html = html.replace(/<img\b[^>]*\bsrc=["']FOTO:[^"']*["'][^>]*>/gi, '').replace(/FOTO:[\w-]+/g, '')

  // 2) ¿El agente ya ubicó el logo en el diseño? (referencia una variante del grupo "marca").
  const logos = (await listarImagenes().catch(() => [])).filter(esLogo)
  const agentePusoLogo = logos.some(l => l.url && html.includes(l.url))

  // 3) Rasterizar el HTML con las fuentes de marca (More Sugar + Inter), colores exactos.
  const { buffer: png } = await renderGraficoHTML({ html, width: dims.w, height: dims.h })

  // 4) Logo: el AGENTE lo ubica dentro del diseño (placement libre, en su HTML). Solo si NO
  //    lo puso, lo estampamos como respaldo (mejor variante por contraste, abajo a la derecha).
  let conLogo = png
  if (!agentePusoLogo) {
    try {
      const r = await aplicarLogoMarca(png, logos, { escala: 0.13 })
      conLogo = r.buffer
      if (r.aplicado) avisos.push('El diseño no incluía el logo: lo agregué abajo a la derecha por defecto.')
    } catch { /* best-effort */ }
  }

  // 5) A JPEG (compatible con IG/FB) + subir a R2 + registrar en el banco.
  let final = conLogo
  let mime = 'image/png'
  let ext = 'png'
  try {
    final = await sharp(conLogo).flatten({ background: '#FBF8F3' }).jpeg({ quality: 92 }).toBuffer()
    mime = 'image/jpeg'; ext = 'jpg'
  } catch { /* deja PNG */ }
  const up = await uploadToR2(final, `mailing/ai-images/${Date.now()}-grafico.${ext}`, mime)
  await registrarImagen({
    url: up.url, key: up.key, descripcion: 'Gráfico de marca', tags: 'grafico',
    grupo: 'otro', subgrupo: 'grafico', aspect: `${dims.w}x${dims.h}`, origen: 'ai', modelo: 'satori', creadoPor: args.creadoPor,
  }).catch(() => { /* registro best-effort */ })

  return { url: up.url, fotos: fotosUsadas, avisos }
}
