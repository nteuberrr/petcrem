import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'

// Rutas permitidas para rol 'operador'. Todo lo demás en el dashboard es solo admin.
const OPERADOR_ALLOWED = ['/clientes', '/operaciones']

function isOperadorAllowed(pathname: string): boolean {
  return OPERADOR_ALLOWED.some(prefix => pathname === prefix || pathname.startsWith(prefix + '/'))
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Rutas públicas: login, NextAuth API, init-sheets, reorder-columns (operaciones admin de schema)
  if (pathname === '/login' || pathname.startsWith('/api/auth') || pathname === '/api/init-sheets' || pathname === '/api/reorder-columns') {
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

  // Admin tiene acceso total
  if (role === 'admin') return NextResponse.next()

  // Operador: solo clientes y operaciones
  if (role === 'operador') {
    if (pathname === '/' || pathname === '/dashboard') {
      return NextResponse.redirect(new URL('/clientes', req.url))
    }
    if (pathname.startsWith('/api/')) {
      // Permitir APIs que las secciones de operador necesitan
      const allowedApis = [
        '/api/clientes', '/api/ciclos', '/api/petroleo',
        '/api/vehiculo', '/api/despachos',
        '/api/especies', '/api/servicios', '/api/productos',
        '/api/veterinarios', '/api/precios', '/api/upload',
        '/api/init-sheets',
      ]
      if (allowedApis.some(p => pathname.startsWith(p))) return NextResponse.next()
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }
    if (!isOperadorAllowed(pathname)) {
      return NextResponse.redirect(new URL('/clientes', req.url))
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
