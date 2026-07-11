/**
 * Sitio público — render del blog (portada + detalle) desde web_posts (CMS panel Web).
 * Reusa las clases de Webflow (post-preview-full / preview-link / category-link…).
 */

import { BASE_URL } from './render'

type Post = Record<string, string>

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const escUrl = (s: unknown) => String(s ?? '').replace(/['"\\<>]/g, '')
const FALLBACK = '/sitio/assets/68780d4f39586a806a378a61_Post-bg.jpg'

export function postsPublicados(posts: Post[]): Post[] {
  return posts
    .filter(p => p.publicado === 'TRUE')
    .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
}

export function buscarPost(posts: Post[], slug: string): Post | undefined {
  return posts.find(p => p.slug === slug && p.publicado === 'TRUE')
}

function card(p: Post): string {
  const url = `/blog/${escUrl(p.slug)}`
  const img = p.foto_url ? escUrl(p.foto_url) : FALLBACK
  return '<div role="listitem" class="post-preview-full w-dyn-item"><div class="left-blog-posst">'
    + `<a href="${url}" class="preview-link-block full-height w-inline-block">`
    + `<img src="${esc(img)}" loading="lazy" alt="${esc(p.titulo)}"/>`
    + `<div style="background-image:url('${img}')" class="hover-image"></div>`
    + '</a></div>'
    + '<div class="preview-text-container">'
    + `<div><a href="${url}" class="category-link">${esc(p.categoria || 'Guías')}</a></div>`
    + `<div class="preview-link-box"><a href="${url}" class="preview-link">${esc(p.titulo)}</a></div>`
    + `<div class="preview-link-box"><p class="paragraph-medium">${esc(p.extracto || '')}</p></div>`
    + '<div class="link-block-box"><div class="mintures-to-read">Leer</div></div>'
    + '</div></div>'
}

export function renderPostsWeb(posts: Post[]): string {
  const pub = postsPublicados(posts)
  if (pub.length === 0) return ''
  return pub.map(card).join('')
}

/**
 * Inyecta título + contenido (HTML del CMS) en la plantilla de detalle, y
 * reemplaza los metadatos de cabecera (title/description/OG/twitter, fijos en
 * el shell exportado de Webflow) por los reales del post — si no, TODOS los
 * artículos comparten el título y la descripción de un único post.
 */
export function renderPostDetalle(shell: string, post: Post): string {
  const tituloVisible = esc(post.titulo)
  const seoTitulo = esc(post.seo_titulo || post.titulo)
  const seoDesc = esc(post.seo_desc || post.extracto || '')
  const url = `${BASE_URL}/blog/${escUrl(post.slug)}`
  const imgRaw = post.foto_url || FALLBACK
  const img = /^https?:\/\//.test(imgRaw) ? escUrl(imgRaw) : `${BASE_URL}${escUrl(imgRaw)}`

  let html = shell
    .replace('<!--INJECT:post-titulo-->', tituloVisible)
    .replace('<!--INJECT:post-contenido-->', post.contenido || '')

  html = html
    .replace(/<title>[^<]*<\/title>/, `<title>${seoTitulo}</title>`)
    .replace(/<meta content="[^"]*" name="description"\/>/, `<meta content="${seoDesc}" name="description"/>`)
    .replace(/<meta content="[^"]*" property="og:title"\/>/, `<meta content="${seoTitulo}" property="og:title"/>`)
    .replace(/<meta content="[^"]*" property="og:description"\/>/, `<meta content="${seoDesc}" property="og:description"/>`)
    .replace(/<meta content="[^"]*" property="og:image"\/>/, `<meta content="${img}" property="og:image"/>`)
    .replace(/<meta content="[^"]*" name="twitter:title"\/>/, `<meta content="${seoTitulo}" name="twitter:title"/>`)
    .replace(/<meta content="[^"]*" name="twitter:description"\/>/, `<meta content="${seoDesc}" name="twitter:description"/>`)
    .replace(/<meta content="[^"]*" name="twitter:image"\/>/, `<meta content="${img}" name="twitter:image"/>`)

  // El shell no trae canonical ni og:url (ambos ausentes en el export original).
  if (!html.includes('rel="canonical"')) {
    html = html.replace('</title>', `</title><link rel="canonical" href="${url}"/><meta property="og:url" content="${url}"/>`)
  }
  return html
}
