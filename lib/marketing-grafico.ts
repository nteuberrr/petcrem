import sharp from 'sharp'
import { renderGraficoHTML } from './grafico-render'
import { generarYGuardarImagen, listarImagenes, registrarImagen } from './mailing-images'
import { aplicarLogoMarca, esLogo } from './marca-logo'
import { uploadToR2, getFromR2, keyFromPublicUrl } from './cloudflare-r2'
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
  /** Código de campaña asignado a la pieza (C-X.Y). */
  codigo: string
  /** Fotos generadas (slot → URL) para que el agente las REUSE si solo ajusta el texto. */
  fotos: { slot: string; url: string }[]
  avisos: string[]
}

export async function generarGraficoMarca(args: {
  formato: string
  html: string
  fotos?: FotoGrafico[]
  creadoPor?: string
  /** Si la placa es parte de un carrusel/pieza, su campaña reservada → queda C-X.Y. */
  campania?: string
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
  // Es una PUBLICACIÓN (portada/placa con texto) → código de campaña C-X.1.
  const reg = await registrarImagen({
    url: up.url, key: up.key, descripcion: 'Gráfico de marca', tags: 'grafico',
    grupo: 'otro', subgrupo: 'grafico', aspect: `${dims.w}x${dims.h}`, origen: 'ai', modelo: 'satori',
    creadoPor: args.creadoPor, kind: 'publicacion', campania: args.campania,
  }).catch(() => null)
  const codigo = reg?.codigo || ''

  // 6) SIDECAR DE DISEÑO: guardamos junto a la imagen el HTML FINAL (ya con las URLs
  //    reales de las fotos sustituidas) + el formato. Así, cuando el dueño pida
  //    AJUSTAR el gráfico, el agente puede partir de este HTML EXACTO y cambiar solo
  //    lo pedido — sin rehacer el diseño ni regenerar las fotos. (El chat solo
  //    persiste texto: sin esto el agente no tiene cómo recuperar lo que diseñó.)
  try {
    await uploadToR2(
      Buffer.from(JSON.stringify({ formato: args.formato, html, fotos: fotosUsadas }), 'utf8'),
      diseñoKey(up.key),
      'application/json',
    )
  } catch { /* best-effort: sin sidecar el agente igual puede recrear desde cero */ }

  return { url: up.url, codigo, fotos: fotosUsadas, avisos }
}

/** Key del sidecar de diseño a partir de la key de la imagen del gráfico. */
function diseñoKey(imageKey: string): string {
  return imageKey.replace(/\.(jpe?g|png)$/i, '') + '.design.json'
}

export interface DisenoGrafico {
  formato: string
  /** HTML FINAL del gráfico, con las URLs reales de las fotos ya sustituidas. */
  html: string
  fotos: { slot: string; url: string }[]
}

/**
 * Carga el estado de diseño (HTML final + fotos) de un gráfico ya generado, por su
 * URL pública. Devuelve null si esa URL no es un gráfico con sidecar (p. ej. una
 * foto suelta o una imagen vieja anterior a esta función) — el llamador lo ignora.
 */
export async function cargarDisenoGrafico(url: string): Promise<DisenoGrafico | null> {
  try {
    const key = keyFromPublicUrl(url)
    if (!key) return null
    const dk = diseñoKey(key)
    if (dk === key) return null
    const buf = await getFromR2(dk)
    if (!buf) return null
    const d = JSON.parse(buf.toString('utf8')) as Partial<DisenoGrafico>
    if (!d?.html) return null
    return { formato: String(d.formato || 'post'), html: String(d.html), fotos: Array.isArray(d.fotos) ? d.fotos : [] }
  } catch { return null }
}
