/**
 * Sitio público — render del blog (portada + detalle) desde web_posts (CMS panel Web).
 * Reusa las clases de Webflow (post-preview-full / preview-link / category-link…).
 */

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

/** Inyecta título + contenido (HTML del CMS) en la plantilla de detalle. */
export function renderPostDetalle(shell: string, post: Post): string {
  return shell
    .replace('<!--INJECT:post-titulo-->', esc(post.titulo))
    .replace('<!--INJECT:post-contenido-->', post.contenido || '')
}
