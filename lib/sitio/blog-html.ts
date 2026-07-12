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

/** Fecha ISO → DD/MM/YYYY para la tarjeta (sin depender de lib/dates en el sitio). */
function fmtFechaCard(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

function card(p: Post): string {
  const url = `/blog/${escUrl(p.slug)}`
  const img = p.foto_url ? escUrl(p.foto_url) : FALLBACK
  return `<a href="${url}" class="aa-post-card">`
    + `<img src="${esc(img)}" loading="lazy" alt="${esc(p.titulo)}"/>`
    + '<div class="aa-post-body">'
    + `<div class="aa-post-top"><span class="aa-post-cat">${esc(p.categoria || 'Guías')}</span><span class="aa-post-fecha">${esc(fmtFechaCard(p.fecha))}</span></div>`
    + `<div class="aa-post-title">${esc(p.titulo)}</div>`
    + `<p class="aa-post-exc">${esc(p.extracto || '')}</p>`
    + '<span class="aa-post-leer">Leer artículo →</span>'
    + '</div></a>'
}

/**
 * Grilla de tarjetas propia (cards/boxes), autocontenida: reemplaza el listado
 * plano de Webflow, que con 15 artículos no distinguía uno de otro (pedido del
 * dueño 2026-07-12: "que se vea excelente en teléfono y PC, en boxes"). La
 * tipografía se HEREDA de la página (sin font-family propio); solo paleta de
 * marca (navy/dorado/crema). 1 columna en móvil, 2-3 en escritorio (auto-fill).
 */
export function renderPostsWeb(posts: Post[]): string {
  const pub = postsPublicados(posts)
  if (pub.length === 0) return ''
  const css = '<style>'
    + '.aa-blog-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:24px;margin-top:8px}'
    + '.aa-post-card{display:flex;flex-direction:column;background:#fff;border:1px solid #e6e0d6;border-radius:16px;overflow:hidden;box-shadow:0 2px 10px rgba(20,60,100,.06);text-decoration:none;transition:transform .15s ease,box-shadow .15s ease}'
    + '.aa-post-card:hover{transform:translateY(-3px);box-shadow:0 10px 24px rgba(20,60,100,.14)}'
    + '.aa-post-card>img{width:100%;height:185px;object-fit:cover;display:block}'
    + '.aa-post-body{display:flex;flex-direction:column;gap:9px;padding:18px 20px 20px;flex:1}'
    + '.aa-post-top{display:flex;align-items:center;justify-content:space-between;gap:8px}'
    + '.aa-post-cat{background:#F2B84B;color:#143C64;font-size:12px;font-weight:700;border-radius:999px;padding:3px 12px;letter-spacing:.02em}'
    + '.aa-post-fecha{color:#98a3ad;font-size:12.5px}'
    + '.aa-post-title{color:#143C64;font-size:19px;font-weight:700;line-height:1.32}'
    + '.aa-post-exc{color:#5b6b7a;font-size:14.5px;line-height:1.55;margin:0;flex:1;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}'
    + '.aa-post-leer{color:#2A6DB0;font-weight:600;font-size:14px}'
    + '@media (max-width:560px){.aa-blog-grid{grid-template-columns:1fr;gap:18px}.aa-post-card>img{height:200px}}'
    + '</style>'
  return css + `<div class="aa-blog-grid">${pub.map(card).join('')}</div>`
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
