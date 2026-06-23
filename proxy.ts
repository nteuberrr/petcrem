import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { normalizarRol } from '@/lib/roles'
import { esRutaAvanzada, getPermisosConfig, puedeAcceder } from '@/lib/permisos'

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Rutas públicas: login, NextAuth API, init-sheets, reorder-columns (operaciones admin de schema),
  // webhook de Resend (lo llama Resend, no un usuario; se valida por signature),
  // endpoints de tracking (los llaman clientes de email — Gmail/Outlook — sin sesión),
  // landing público del convenio de eutanasias + endpoints que ese landing usa
  // (GET de precios para mostrar tabla, POST de inscripción).
  if (
    pathname === '/login' ||
    pathname.startsWith('/api/auth') ||
    // Política de privacidad pública (la exige Meta para publicar la app + es buena práctica).
    pathname === '/privacidad' ||
    pathname === '/api/init-sheets' ||
    pathname === '/api/reorder-columns' ||
    pathname === '/api/mailing/webhooks/resend' ||
    pathname === '/api/mensajes/webhook' ||
    // Backup automático (lo llama Vercel Cron; auth por Bearer CRON_SECRET dentro de la ruta)
    pathname === '/api/backup' ||
    // Publicación programada de campañas sociales (Vercel Cron; auth Bearer CRON_SECRET
    // o sesión admin dentro de la ruta)
    pathname === '/api/mailing/cron-publicar' ||
    pathname.startsWith('/api/mailing/pixel/') ||
    pathname.startsWith('/api/mailing/click/') ||
    pathname === '/convenio-eutanasias' ||
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
    pathname === '/api/eutanasias/precios' ||
    pathname === '/api/eutanasias/vets/inscribir' ||
    // Autocomplete de comunas usado tanto en el landing público como en el
    // form del datos-pago. Sin esto, mobile sin sesión recibe HTML de /login.
    pathname === '/api/eutanasias/comunas/buscar' ||
    pathname.startsWith('/eutanasia/aceptar/') ||
    pathname.startsWith('/eutanasia/confirmar/') ||
    pathname.startsWith('/eutanasia/realizado/') ||
    pathname.startsWith('/eutanasia/datos-pago/') ||
    pathname.startsWith('/eutanasia/cliente-confirma/') ||
    pathname === '/api/eutanasias/cotizaciones/aceptar' ||
    pathname === '/api/eutanasias/cotizaciones/confirmar' ||
    pathname === '/api/eutanasias/cotizaciones/realizado' ||
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
