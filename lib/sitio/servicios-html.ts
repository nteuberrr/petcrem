/**
 * Sitio público — render de las tarjetas de servicio para /servicios, reusando las
 * clases de Webflow (service / service-image-block / service-preview-link /
 * paragraph-2). Fuente = web_servicios (CMS del panel Web). Cada tarjeta enlaza a
 * su detalle /servicios/<slug>.
 */

type Serv = Record<string, string>

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const escUrl = (s: unknown) => String(s ?? '').replace(/['"\\<>]/g, '')
const FALLBACK_IMG = '/sitio/assets/68780d4f39586a806a378a45_Work-Bg-2.jpg'

export function serviciosPublicados(servicios: Serv[]): Serv[] {
  return servicios
    .filter(s => s.publicado !== 'FALSE')
    .sort((a, b) => (parseInt(a.orden || '0', 10) || 0) - (parseInt(b.orden || '0', 10) || 0))
}

function tarjeta(s: Serv): string {
  const url = `/servicios/${escUrl(s.slug)}`
  const img = s.foto_url ? escUrl(s.foto_url) : FALLBACK_IMG
  return '<div role="listitem" class="service w-dyn-item"><div class="div-block">'
    + `<a href="${url}" class="service-image-block w-inline-block">`
    + `<img src="${esc(img)}" loading="lazy" alt="${esc(s.nombre)}"/>`
    + `<div style="background-image:url('${img}')" class="hover-image"><div class="button-hover">Ver servicio</div></div>`
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
