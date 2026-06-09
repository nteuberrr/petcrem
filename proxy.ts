import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { esApiAvanzada } from '@/lib/roles'

// Rutas permitidas para rol 'operador'. Todo lo demás en el dashboard es solo admin.
const OPERADOR_ALLOWED = ['/dashboard', '/clientes', '/operaciones', '/asistencia']

function isOperadorAllowed(pathname: string): boolean {
  return OPERADOR_ALLOWED.some(prefix => pathname === prefix || pathname.startsWith(prefix + '/'))
}

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
    pathname === '/api/init-sheets' ||
    pathname === '/api/reorder-columns' ||
    pathname === '/api/mailing/webhooks/resend' ||
    pathname === '/api/mensajes/webhook' ||
    // Backup automático (lo llama Vercel Cron; auth por Bearer CRON_SECRET dentro de la ruta)
    pathname === '/api/backup' ||
    pathname.startsWith('/api/mailing/pixel/') ||
    pathname.startsWith('/api/mailing/click/') ||
    pathname === '/convenio-eutanasias' ||
    // Registro público de mascota (auto-atención del tutor) + su endpoint de
    // metadata/creación. Cliente general "sin veterinaria", sin sesión.
    pathname === '/registro-mascota' ||
    pathname === '/api/clientes/publico' ||
    // Subida pública de la foto de la mascota (link del correo de registro).
    pathname === '/subir-foto' ||
    pathname === '/api/clientes/foto' ||
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

  const role = (token.role as string) ?? 'operador'

  // Admin (1) tiene acceso total
  if (role === 'admin') return NextResponse.next()

  // Admin 2: igual que admin, pero NO puede tocar el backend de "Configuración Avanzada"
  // (Datos personales, Agentes, Mantenimiento). El resto, acceso total.
  if (role === 'admin2') {
    if (pathname.startsWith('/api/') && esApiAvanzada(pathname)) {
      return NextResponse.json({ error: 'No autorizado: Configuración Avanzada es solo del administrador.' }, { status: 403 })
    }
    return NextResponse.next()
  }

  // Operador: solo dashboard, clientes, operaciones y asistencia
  if (role === 'operador') {
    if (pathname === '/') {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }
    if (pathname.startsWith('/api/')) {
      // Permitir APIs que las secciones de operador necesitan
      const allowedApis = [
        '/api/dashboard',
        '/api/clientes', '/api/ciclos', '/api/petroleo',
        '/api/vehiculo', '/api/despachos',
        '/api/especies', '/api/servicios', '/api/productos',
        '/api/veterinarios', '/api/precios', '/api/descuentos', '/api/upload',
        '/api/init-sheets', '/api/places',
        '/api/asistencia', '/api/jornada-config', '/api/retiros-adicionales',
      ]
      if (allowedApis.some(p => pathname.startsWith(p))) return NextResponse.next()
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }
    if (!isOperadorAllowed(pathname)) {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    // Todas las rutas salvo _next, static, favicon y public files
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|gif|ico)).*)',
  ],
}
