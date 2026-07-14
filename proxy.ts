import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { normalizarRol } from '@/lib/roles'
import { esRutaAvanzada, getPermisosConfig, puedeAcceder } from '@/lib/permisos'

// ── Sitio público (crematorioalmaanimal.cl) ─────────────────────────────────
// Rutas de marketing que, en el dominio del sitio, se reescriben a /sitio/*.
// En petcrem.vercel.app estas mismas rutas siguen siendo el panel admin (ej.
// /servicios = Eutanasias) → el enrutado depende del hostname.
const SITIO_EXACT = new Set([
  '/', '/nosotros', '/servicios', '/convenios', '/contacto',
  '/anforas', '/catalogo-anforas', '/blog',
  '/terminos-y-condiciones', '/politicas-de-privacidad',
  '/sitemap.xml', '/robots.txt',
  // Landings de captación (Google Ads + SEO).
  '/cremacion-de-mascotas', '/eutanasia-a-domicilio', '/cremacion-de-perros', '/cremacion-de-gatos',
])
const SITIO_PREFIX = ['/servicios/', '/blog/']
function esRutaSitioPublico(p: string): boolean {
  return SITIO_EXACT.has(p) || SITIO_PREFIX.some(pre => p.startsWith(pre))
}
// URLs viejas de Webflow → nuevas (301 permanente, para no perder SEO ni links).
function redireccionVieja(p: string): string | null {
  if (p.startsWith('/service/')) return '/servicios/' + p.slice('/service/'.length)
  if (p.startsWith('/post-category/')) return '/blog'
  if (p.startsWith('/post/')) return '/blog/' + p.slice('/post/'.length)
  if (p === '/catalogo-anforas') return '/anforas'
  // Restos de plantilla / ecommerce viejo que ya no existen → home.
  if (p.startsWith('/resources/') || p.startsWith('/product/') || p.startsWith('/category/')
    || p === '/checkout' || p === '/paypal-checkout' || p === '/order-confirmation') return '/'
  return null
}
function esDominioSitio(host: string): boolean {
  const h = (host || '').toLowerCase().split(':')[0]
  return h === 'crematorioalmaanimal.cl' || h.endsWith('.crematorioalmaanimal.cl')
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Dominio del sitio público: 301 de URLs viejas + reescritura de las URLs
  // limpias del marketing al route handler /sitio/* (páginas fieles de Webflow).
  // El panel admin sigue disponible en este dominio por sus rutas (/login, /dashboard…).
  if (esDominioSitio(req.headers.get('host') || '')) {
    const destino = redireccionVieja(pathname)
    if (destino) {
      const url = req.nextUrl.clone()
      url.pathname = destino
      url.search = ''
      return NextResponse.redirect(url, 301)
    }
    if (esRutaSitioPublico(pathname)) {
      const url = req.nextUrl.clone()
      url.pathname = '/sitio' + (pathname === '/' ? '' : pathname)
      return NextResponse.rewrite(url)
    }
  }

  // Rutas públicas: login, NextAuth API, init-sheets, reorder-columns (operaciones admin de schema),
  // webhook de Resend (lo llama Resend, no un usuario; se valida por signature),
  // endpoints de tracking (los llaman clientes de email — Gmail/Outlook — sin sesión),
  // landing público del convenio de eutanasias + endpoints que ese landing usa
  // (GET de precios para mostrar tabla, POST de inscripción).
  if (
    pathname === '/login' ||
    // Sitio público: el route handler /sitio/* + sus assets estáticos
    // (/sitio/site.css, /sitio/js, /sitio/assets) son públicos, sin sesión.
    pathname.startsWith('/sitio') ||
    pathname.startsWith('/api/auth') ||
    // Política de privacidad pública (la exige Meta para publicar la app + es buena práctica).
    pathname === '/privacidad' ||
    pathname === '/api/init-sheets' ||
    pathname === '/api/reorder-columns' ||
    // Reenvío del link de completar-borrador al tutor (auth Bearer CRON_SECRET o
    // sesión admin DENTRO de la ruta; se llama en prod para firmar el token allí).
    (pathname.startsWith('/api/clientes/') && pathname.endsWith('/reenviar-link-borrador')) ||
    pathname === '/api/mailing/webhooks/resend' ||
    pathname === '/api/mensajes/webhook' ||
    // Backup automático (lo llama Vercel Cron; auth por Bearer CRON_SECRET dentro de la ruta)
    pathname === '/api/backup' ||
    // Publicación programada de campañas sociales (Vercel Cron; auth Bearer CRON_SECRET
    // o sesión admin dentro de la ruta)
    pathname === '/api/mailing/cron-publicar' ||
    // Cron diario que archiva conversaciones inactivas (Vercel Cron; auth Bearer
    // CRON_SECRET o sesión admin dentro de la ruta).
    pathname === '/api/mensajes/cron-archivar' ||
    // Seguimiento automático de leads tibios (se dispara desde el cron diario o
    // a mano para pruebas; auth Bearer CRON_SECRET o sesión admin dentro de la ruta).
    pathname === '/api/mensajes/cron-seguimiento' ||
    pathname.startsWith('/api/mailing/pixel/') ||
    pathname.startsWith('/api/mailing/click/') ||
    pathname === '/convenio-eutanasias' ||
    // Autoinscripción pública de clínicas al convenio de CREMACIÓN (hoja
    // veterinarios, tarifas de convenio automáticas).
    pathname === '/convenio-veterinarias' ||
    pathname === '/api/veterinarios/inscribir' ||
    // Tabla de tarifas de convenio para el landing (solo lectura de precios_convenio).
    pathname === '/api/veterinarios/precios-convenio' ||
    // Registro público de mascota (auto-atención del tutor) + su endpoint de
    // metadata/creación. Cliente general "sin veterinaria", sin sesión.
    pathname === '/registro-mascota' ||
    pathname === '/api/clientes/publico' ||
    // Completar el borrador desde el link firmado del WhatsApp de retiro
    // confirmado (auth = token HMAC; NO genera código, solo enriquece el borrador).
    pathname === '/api/clientes/completar-borrador' ||
    // Subida pública de la foto + solicitud del video (links del correo de registro).
    pathname === '/subir-foto' ||
    pathname === '/api/clientes/foto' ||
    pathname === '/solicitar-video' ||
    pathname === '/api/clientes/video' ||
    // Confirmación pública de transferencia (botón del correo de cobro). Auth =
    // token HMAC firmado; el endpoint es idempotente.
    pathname.startsWith('/pago/confirma/') ||
    pathname === '/api/pago/confirmar' ||
    pathname === '/api/eutanasias/precios' ||
    pathname === '/api/eutanasias/vets/inscribir' ||
    // Autocomplete de comunas usado tanto en el landing público como en el
    // form del datos-pago. Sin esto, mobile sin sesión recibe HTML de /login.
    pathname === '/api/eutanasias/comunas/buscar' ||
    pathname.startsWith('/eutanasia/aceptar/') ||
    pathname.startsWith('/eutanasia/realizado/') ||
    pathname.startsWith('/eutanasia/no-realizado/') ||
    pathname.startsWith('/eutanasia/datos-pago/') ||
    pathname.startsWith('/eutanasia/cliente-confirma/') ||
    pathname.startsWith('/eutanasia/hora-retiro/') ||
    pathname === '/api/eutanasias/cotizaciones/hora-retiro' ||
    pathname === '/api/eutanasias/cotizaciones/aceptar' ||
    pathname === '/api/eutanasias/cotizaciones/realizado' ||
    pathname === '/api/eutanasias/cotizaciones/no-realizado' ||
    pathname === '/api/eutanasias/cotizaciones/cliente-confirmar' ||
    pathname === '/api/eutanasias/vets/datos-pago'
  ) {
    return NextResponse.next()
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })

  // No autenticado → login
  if (!token) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Usuario desactivado/eliminado detectado por el refresh de rol (lib/auth.ts):
  // se corta la sesión de plano en vez de degradarlo a operador.
  if (token.role === 'desactivado') {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Usuario desactivado' }, { status: 401 })
    }
    return NextResponse.redirect(new URL('/login', req.url))
  }

  // normalizarRol: cualquier rol vacío/desconocido cae a 'operador' (el menos
  // privilegiado) — antes un role '' caía al passthrough final = acceso total.
  const role = normalizarRol(token.role)

  // Admin (1, dueño) tiene acceso total
  if (role === 'admin') return NextResponse.next()

  // Lo usa el sidebar de cualquier usuario logueado para saber qué módulos ve.
  if (pathname === '/api/mis-modulos') return NextResponse.next()

  // Configuración Avanzada SIEMPRE solo del admin (acá vive el editor de permisos →
  // no es toggleable, para no permitir escalar privilegios).
  if (esRutaAvanzada(pathname)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'No autorizado: Configuración Avanzada es solo del administrador.' }, { status: 403 })
    }
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  // admin2 ("General") y operador: gateo DINÁMICO por módulo (editable, ~instantáneo).
  if (role === 'admin2' || role === 'operador') {
    if (role === 'operador' && pathname === '/') {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }
    const config = await getPermisosConfig()
    if (puedeAcceder(role, pathname, config)) return NextResponse.next()
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    // Todas las rutas salvo _next, static, favicon y public files
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|gif|ico)).*)',
  ],
}
