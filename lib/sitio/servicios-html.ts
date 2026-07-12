/**
 * Sitio público — render de las tarjetas de servicio para /servicios, reusando las
 * clases de Webflow (service / service-image-block / service-preview-link /
 * paragraph-2). Fuente = web_servicios (CMS del panel Web). Cada tarjeta enlaza a
 * su detalle /servicios/<slug>.
 */

import { BASE_URL } from './render'

type Serv = Record<string, string>

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const escUrl = (s: unknown) => String(s ?? '').replace(/['"\\<>]/g, '')
const FALLBACK_IMG = '/sitio/assets/68780d4f39586a806a378a45_Work-Bg-2.jpg'
const LOGO = '/sitio/assets/68780d4f39586a806a378a9d_Logo.png'

export function serviciosPublicados(servicios: Serv[]): Serv[] {
  return servicios
    .filter(s => s.publicado !== 'FALSE')
    .sort((a, b) => (parseInt(a.orden || '0', 10) || 0) - (parseInt(b.orden || '0', 10) || 0))
}

function tarjeta(s: Serv): string {
  const url = `/servicios/${escUrl(s.slug)}`
  const img = s.foto_url ? escUrl(s.foto_url) : FALLBACK_IMG
  // Altura FIJA + object-fit en la foto: las imágenes del CMS vienen con
  // proporciones distintas (retrato/paisaje) y sin esto cada tarjeta quedaba de
  // un alto diferente — la grilla se veía descuadrada (reporte del dueño 2026-07-12).
  return '<div role="listitem" class="service w-dyn-item"><div class="div-block">'
    + `<a href="${url}" class="service-image-block w-inline-block" style="display:block;height:240px;overflow:hidden">`
    + `<img src="${esc(img)}" loading="lazy" alt="${esc(s.nombre)}" style="width:100%;height:100%;object-fit:cover;object-position:center"/>`
    + `<div style="background-image:url('${img}');background-size:cover;background-position:center" class="hover-image"><div class="button-hover">Ver servicio</div></div>`
    + '</a>'
    + '<div class="services-text-box">'
    + `<a href="${url}" class="service-preview-link">${esc(s.nombre)}</a>`
    + `<div class="paragraph-service-box"><p class="paragraph-2">${esc(s.resumen)}</p></div>`
    + `<div class="button-box _20-pixels"><a href="${url}" class="link-block w-inline-block"><div>Ver servicio</div></a></div>`
    + '</div></div></div>'
}

export function renderServiciosWeb(servicios: Serv[]): string {
  return serviciosPublicados(servicios).map(tarjeta).join('')
}

/**
 * Inyecta el título/meta description/canonical/OG reales de la ficha de
 * detalle (/servicios/<slug>) usando los campos SEO ya cargados en el panel
 * Web → Servicios (web_servicios.seo_titulo/seo_desc) — la plantilla estática
 * solo trae `<title>Alma Animal</title>` y nada más. Si no hay ficha para ese
 * slug (o le faltan los campos SEO), no toca la plantilla.
 */
export function renderServicioSeo(html: string, servicio: Serv | undefined, slug: string): string {
  if (!servicio) return html
  const titulo = esc(servicio.seo_titulo || (servicio.nombre ? `${servicio.nombre} | Alma Animal` : ''))
  const desc = esc(servicio.seo_desc || servicio.resumen || '')
  if (!titulo && !desc) return html
  const url = `${BASE_URL}/servicios/${escUrl(slug)}`
  const imgRaw = servicio.foto_url || LOGO
  const img = /^https?:\/\//.test(imgRaw) ? escUrl(imgRaw) : `${BASE_URL}${escUrl(imgRaw)}`
  const head =
    `<title>${titulo || 'Alma Animal'}</title>` +
    (desc ? `<meta name="description" content="${desc}"/>` : '') +
    `<link rel="canonical" href="${url}"/>` +
    `<meta property="og:type" content="website"/>` +
    (titulo ? `<meta property="og:title" content="${titulo}"/>` : '') +
    (desc ? `<meta property="og:description" content="${desc}"/>` : '') +
    `<meta property="og:url" content="${url}"/>` +
    `<meta property="og:image" content="${img}"/>`
  return html.replace('<title>Alma Animal</title>', head)
}
