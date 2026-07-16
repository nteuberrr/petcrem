import { NextRequest, NextResponse } from 'next/server'
import { leerTemplate, RUTA_A_TEMPLATE, robotsTxt, construirSitemap } from '@/lib/sitio/render'
import { getSheetData } from '@/lib/datastore'
import { renderProductosWeb } from '@/lib/sitio/productos-html'
import { renderConveniosDescuento } from '@/lib/sitio/convenios-html'
import { renderServiciosWeb, renderServicioSeo } from '@/lib/sitio/servicios-html'
import { renderPreciosServicio, desdePorSlug, fmtCLP, type DatosPrecios } from '@/lib/sitio/precios-html'
import { renderPorqueElegirnos, renderConfianzaStrip } from '@/lib/sitio/porque-html'
import { getFijoEutanasia } from '@/lib/eutanasia-precios'
import { renderPostsWeb, renderPostDetalle, buscarPost } from '@/lib/sitio/blog-html'
import { renderTextos } from '@/lib/sitio/paginas-html'
import { LANDINGS, renderLanding } from '@/lib/sitio/landings'

const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
}

function esDominioMarketing(host: string): boolean {
  const h = (host || '').toLowerCase().split(':')[0]
  return h === 'crematorioalmaanimal.cl' || h.endsWith('.crematorioalmaanimal.cl')
}

const RUTAS_PUB_RE = /href="\/(servicios|nosotros|convenios|contacto|anforas|catalogo-anforas|blog|terminos-y-condiciones|politicas-de-privacidad|cremacion-de-mascotas|cremacion-de-perros|cremacion-de-gatos|funeraria-de-mascotas|precios-cremacion-mascotas|eutanasia-de-perros|eutanasia-de-gatos|incineracion-de-mascotas|eutanasia-a-domicilio)(["/#?])/g

// Precios VIVOS para /servicios y sus detalles (cremación + eutanasia): se leen
// en cada render, así un cambio en Configuración → Precios se refleja en la web.
async function datosPrecios(): Promise<DatosPrecios> {
  const [tramosGen, tramosEut, fijoEut, recargos] = await Promise.all([
    getSheetData('precios_generales').catch(() => []),
    getSheetData('precios_eutanasia').catch(() => []),
    getFijoEutanasia().catch(() => 0),
    getSheetData('otros_servicios').catch(() => []),
  ])
  return { tramosGen, tramosEut, fijoEut, recargos }
}

// Versión de prueba (host != dominio oficial): el sitio vive bajo /sitio/* y el
// proxy NO reescribe el dominio, así que los enlaces internos absolutos (/servicios,
// /nosotros…) no navegan. Acá los prefijamos con /sitio para poder recorrer todo.
// En el dominio real quedan tal cual (el proxy hace el rewrite).
function prefijarLinksSitio(html: string): string {
  return html.replace(RUTAS_PUB_RE, 'href="/sitio/$1$2')
    .replace(/href="\/"/g, 'href="/sitio"')
    // anclas al home (menú "Por qué elegirnos" / "Preguntas frecuentes")
    .replace(/href="\/#/g, 'href="/sitio#')
}

/**
 * Sitio público crematorioalmaanimal.cl — sirve las páginas fieles de Webflow.
 * El proxy (host-based) reescribe las URLs limpias del dominio de marketing a
 * /sitio/<ruta>; acá se resuelve la plantilla y se devuelve como HTML completo.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params
  const key = (slug || []).join('/')
  // En la versión de prueba (host != dominio oficial) navegamos bajo /sitio/*.
  const prefijar = !esDominioMarketing(req.headers.get('host') || '')
  const fin = (html: string) => new NextResponse(prefijar ? prefijarLinksSitio(html) : html, { status: 200, headers: HTML_HEADERS })

  // robots.txt + sitemap.xml del sitio público.
  if (key === 'robots.txt') {
    return new NextResponse(robotsTxt(), { headers: { 'content-type': 'text/plain; charset=utf-8' } })
  }
  if (key === 'sitemap.xml') {
    const [servicios, posts] = await Promise.all([
      getSheetData('web_servicios').catch(() => []),
      getSheetData('web_posts').catch(() => []),
    ])
    return new NextResponse(construirSitemap(servicios, posts), {
      headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=0, s-maxage=3600' },
    })
  }

  // Landings de captación (Google Ads + SEO). La de precios lleva tarifas VIVAS.
  if (LANDINGS[key]) {
    const desde = LANDINGS[key].bloquePrecios ? desdePorSlug(await datosPrecios()) : undefined
    return fin(renderLanding(LANDINGS[key], desde))
  }

  // Detalle de post: /blog/<slug> → shell post-detalle + contenido de web_posts.
  if (key.startsWith('blog/')) {
    const posts = await getSheetData('web_posts').catch(() => [])
    const post = buscarPost(posts, key.slice('blog/'.length))
    const shell = leerTemplate('post-detalle')
    if (post && shell) {
      return fin(renderPostDetalle(shell, post))
    }
    return new NextResponse('Página no encontrada', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  }

  let tpl = RUTA_A_TEMPLATE[key]
  // Detalle de servicio: /servicios/<slug> → plantilla service-<slug> (fiel).
  const servicioSlug = !tpl && key.startsWith('servicios/') ? key.slice('servicios/'.length) : ''
  if (servicioSlug) tpl = 'service-' + servicioSlug
  let html = tpl ? leerTemplate(tpl) : null
  if (!html) {
    return new NextResponse('Página no encontrada', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  }

  // Título/meta reales del servicio (el CMS ya los tiene cargados en web_servicios;
  // la plantilla estática solo trae un <title>Alma Animal</title> genérico).
  if (servicioSlug) {
    const [servicios, precios] = await Promise.all([
      getSheetData('web_servicios').catch(() => []),
      datosPrecios(),
    ])
    const servicio = servicios.find(s => s.slug === servicioSlug)
    html = renderServicioSeo(html, servicio, servicioSlug)
    html = renderPreciosServicio(html, servicioSlug, precios)
  }

  // Inyección de contenido dinámico según la página.
  if (tpl === 'catalogo-anforas' && html.includes('<!--INJECT:productos-->')) {
    const [productos, otrosServicios] = await Promise.all([
      getSheetData('productos').catch(() => []),
      getSheetData('otros_servicios').catch(() => []),
    ])
    html = html.replace('<!--INJECT:productos-->', renderProductosWeb(productos, otrosServicios))
  }
  if (tpl === 'catalogo-anforas' && html.includes('<!--INJECT:convenios-descuento-->')) {
    const descuentos = await getSheetData('descuentos').catch(() => [])
    html = html.replace('<!--INJECT:convenios-descuento-->', renderConveniosDescuento(descuentos))
  }
  // Sección SEO "¿Por qué elegirnos?" + FAQ con schema (home, precios vivos)
  // y franja de confianza bajo el hero (ancla a la sección).
  if (tpl === 'home' && html.includes('<!--INJECT:porque-elegirnos-->')) {
    html = html.replace('<!--INJECT:porque-elegirnos-->', renderPorqueElegirnos(await datosPrecios()))
  }
  if (tpl === 'home' && html.includes('<!--INJECT:confianza-->')) {
    html = html.replace('<!--INJECT:confianza-->', renderConfianzaStrip())
  }
  // Precios "Desde" de las tarjetas del hero de la home (y la meta description):
  // marcadores %%DESDE:<slug>%% → tarifa VIVA, la misma fuente que /servicios
  // (antes estaban hardcodeados en el template y quedaban desactualizados).
  if (tpl === 'home' && html.includes('%%DESDE:')) {
    const desde = desdePorSlug(await datosPrecios())
    html = html.replace(/%%DESDE:([a-z-]+)%%/g, (_m, slug: string) =>
      desde[slug] > 0 ? fmtCLP(desde[slug]) : 'Consultar')
  }
  if (tpl === 'servicios' && html.includes('<!--INJECT:servicios-->')) {
    const [servicios, precios] = await Promise.all([
      getSheetData('web_servicios').catch(() => []),
      datosPrecios(),
    ])
    html = html.replace('<!--INJECT:servicios-->', renderServiciosWeb(servicios, desdePorSlug(precios)))
  }
  if (tpl === 'blog' && html.includes('<!--INJECT:posts-->')) {
    const posts = await getSheetData('web_posts').catch(() => [])
    html = html.replace('<!--INJECT:posts-->', renderPostsWeb(posts))
  }
  // Textos editables de páginas fijas (web_paginas).
  if (html.includes('<!--PAG:')) {
    const paginas = await getSheetData('web_paginas').catch(() => [])
    html = renderTextos(html, paginas)
  }

  return fin(html)
}
