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
  return `<a href="${url}" class="aa-serv-card">`
    + `<img src="${esc(img)}" loading="lazy" alt="${esc(s.nombre)}"/>`
    + '<div class="aa-serv-body">'
    + `<div class="aa-serv-title">${esc(s.nombre)}</div>`
    + `<p class="aa-serv-exc">${esc(s.resumen)}</p>`
    + '<span class="aa-serv-btn">Ver servicio</span>'
    + '</div></a>'
}

/**
 * Grilla de tarjetas propia (boxes uniformes), igual tratamiento que el blog:
 * el markup original de Webflow (círculo "Ver servicio" flotante + caja lavanda
 * con margin-top:-85px superpuesta a la foto) se descuadraba con fotos de
 * proporciones distintas y quedaba con alturas dispares (reporte del dueño
 * 2026-07-12 "se sigue viendo mal"). Tipografía HEREDADA de la página; paleta
 * de marca. 1 columna en móvil, 2 en tablet, 4 en escritorio ancho.
 */
export function renderServiciosWeb(servicios: Serv[]): string {
  const pub = serviciosPublicados(servicios)
  if (pub.length === 0) return ''
  const css = '<style>'
    + '.aa-serv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:24px;margin-top:8px}'
    + '.aa-serv-card{display:flex;flex-direction:column;background:#fff;border:1px solid #e6e0d6;border-radius:16px;overflow:hidden;box-shadow:0 2px 10px rgba(20,60,100,.06);text-decoration:none;transition:transform .15s ease,box-shadow .15s ease}'
    + '.aa-serv-card:hover{transform:translateY(-3px);box-shadow:0 10px 24px rgba(20,60,100,.14)}'
    + '.aa-serv-card>img{width:100%;height:210px;object-fit:cover;object-position:center;display:block}'
    + '.aa-serv-body{display:flex;flex-direction:column;gap:10px;padding:20px 22px 22px;flex:1}'
    + '.aa-serv-title{color:#143C64;font-size:20px;font-weight:700;line-height:1.3}'
    + '.aa-serv-exc{color:#5b6b7a;font-size:14.5px;line-height:1.55;margin:0;flex:1}'
    + '.aa-serv-btn{display:inline-block;align-self:flex-start;background:#143C64;color:#fff;font-size:14px;font-weight:600;border-radius:999px;padding:9px 22px;transition:background .15s ease}'
    + '.aa-serv-card:hover .aa-serv-btn{background:#0e2c4b}'
    + '@media (max-width:560px){.aa-serv-grid{grid-template-columns:1fr;gap:18px}.aa-serv-card>img{height:220px}}'
    + '</style>'
  return css + `<div class="aa-serv-grid">${pub.map(tarjeta).join('')}</div>`
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
