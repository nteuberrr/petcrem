import fs from 'fs'
import path from 'path'

/**
 * Sitio público (crematorioalmaanimal.cl) — lector de plantillas HTML fieles a
 * Webflow. Cada plantilla vive en lib/sitio/templates/<slug>.html con los assets
 * ya localizados a /sitio/assets|js y el pixel (GTM/GA4/Meta) embebido tal cual.
 *
 * El route handler [[...slug]] las sirve como documento HTML completo (no dentro
 * del layout de React) → fidelidad total y cero conflicto con el CSS de la app.
 * El contenido dinámico (productos, servicios, blog, textos) se inyecta por
 * marcadores antes de servir (ver inyectarContenido).
 */

const DIR = path.join(process.cwd(), 'lib', 'sitio', 'templates')
const cache = new Map<string, string>()

/** Mapa ruta pública → nombre de plantilla. */
export const RUTA_A_TEMPLATE: Record<string, string> = {
  '': 'home',
  'nosotros': 'nosotros',
  'servicios': 'servicios',
  'convenios': 'convenios',
  'contacto': 'contacto',
  'anforas': 'catalogo-anforas',
  'catalogo-anforas': 'catalogo-anforas',
  'blog': 'blog',
  'terminos-y-condiciones': 'terminos-y-condiciones',
  'politicas-de-privacidad': 'politicas-de-privacidad',
}

import { LANDINGS } from './landings'

export const BASE_URL = 'https://www.crematorioalmaanimal.cl'
const RUTAS_PUBLICAS = ['/', '/nosotros', '/servicios', '/convenios', '/contacto', '/anforas', '/blog', '/terminos-y-condiciones', '/politicas-de-privacidad']

/** robots.txt del sitio público. */
export function robotsTxt(): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${BASE_URL}/sitemap.xml\n`
}

/** sitemap.xml: páginas fijas + detalle de servicios/posts publicados. */
export function construirSitemap(servicios: Record<string, string>[] = [], posts: Record<string, string>[] = []): string {
  const urls = [...RUTAS_PUBLICAS, ...Object.keys(LANDINGS).map(s => `/${s}`)]
  for (const s of servicios) if (s.publicado !== 'FALSE' && s.slug) urls.push(`/servicios/${s.slug}`)
  for (const p of posts) if (p.publicado === 'TRUE' && p.slug) urls.push(`/blog/${p.slug}`)
  const items = urls.map(u => `<url><loc>${BASE_URL}${u}</loc></url>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${items}</urlset>`
}

export function leerTemplate(slug: string): string | null {
  const safe = slug.replace(/[^a-z0-9-]/gi, '') || 'home'
  if (process.env.NODE_ENV === 'production' && cache.has(safe)) return cache.get(safe)!
  const file = path.join(DIR, `${safe}.html`)
  if (!fs.existsSync(file)) return null
  const html = fs.readFileSync(file, 'utf8')
  cache.set(safe, html)
  return html
}
