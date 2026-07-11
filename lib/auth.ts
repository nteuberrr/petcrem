import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { getSheetData, updateById } from '@/lib/datastore'
import { normalizarRol } from '@/lib/roles'
import { estaBloqueado, registrarIntentoFallido, limpiarIntentosFallidos } from '@/lib/login-rate-limit'

const BCRYPT_RE = /^\$2[aby]\$/

/** Comparación timing-safe; el sha256 previo evita el throw de timingSafeEqual con largos distintos. */
function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest()
  const hb = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(ha, hb)
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credenciales',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Contraseña', type: 'password' },
      },
      async authorize(credentials, req) {
        const email = credentials?.email ?? ''
        const password = credentials?.password ?? ''
        if (!email || !password) return null

        // Rate limiting por email+IP (tabla login_intentos): 5 fallidos en 15 min
        // → bloqueado. Fail-open si Supabase falla (no debe tumbar el acceso).
        const xff = req?.headers?.['x-forwarded-for']
        const ip = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim() || 'unknown'
        if (await estaBloqueado(email, ip)) {
          throw new Error('Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.')
        }

        // Admin from env always works
        if (
          process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD &&
          email === process.env.ADMIN_EMAIL &&
          safeEqual(password, process.env.ADMIN_PASSWORD)
        ) {
          await limpiarIntentosFallidos(email, ip)
          return { id: '0', name: 'Administrador', email, role: 'admin' }
        }
        // Check usuarios sheet
        try {
          const usuarios = await getSheetData('usuarios')
          const u = usuarios.find(u => u.email === email && u.activo === 'TRUE')
          if (u && u.password) {
            const esHash = BCRYPT_RE.test(u.password)
            const ok = esHash
              ? bcrypt.compareSync(password, u.password)
              : safeEqual(password, u.password)
            if (ok) {
              if (!esHash) {
                // Re-hash on-login de passwords legacy en texto plano; best-effort, nunca bloquea el login
                try {
                  await updateById('usuarios', u.id, { ...u, password: bcrypt.hashSync(password, 10) })
                } catch (e) {
                  console.error('[auth] no se pudo re-hashear password legacy:', e)
                }
              }
              await limpiarIntentosFallidos(email, ip)
              // normalizarRol: una celda 'rol' vacía/desconocida cae a 'operador'
              // (no a '' que el proxy dejaría pasar). Las celdas vacías llegan como ''.
              return { id: u.id, name: u.nombre, email: u.email, role: normalizarRol(u.rol) }
            }
          }
        } catch (e) {
          console.error('[auth] error consultando usuarios:', e)
        }
        await registrarIntentoFallido(email, ip)
        return null
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: string }).role ?? 'operador'
        token.id = (user as { id?: string }).id ?? ''
        token.rolRefrescado = Date.now()
        return token
      }
      // Refresh del rol cada 10 min: un cambio de rol o la desactivación en
      // `usuarios` aplica sin esperar a que la persona cierre sesión. Corre
      // cuando el cliente consulta /api/auth/session (el cookie se re-firma y
      // el proxy ve el rol nuevo). El admin por env (id '0') no está en la tabla.
      const REFRESH_MS = 10 * 60_000
      const last = typeof token.rolRefrescado === 'number' ? token.rolRefrescado : 0
      if (token.id && token.id !== '0' && Date.now() - last > REFRESH_MS) {
        try {
          const usuarios = await getSheetData('usuarios')
          const u = usuarios.find(x => x.id === token.id)
          token.role = (u && u.activo === 'TRUE') ? normalizarRol(u.rol) : 'desactivado'
          token.rolRefrescado = Date.now()
        } catch (e) {
          // Si la lectura falla mantenemos el rol vigente y reintentamos después.
          console.error('[auth] refresh de rol falló:', e)
        }
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role as string
        ;(session.user as { id?: string }).id = (token.id as string) ?? ''
      }
      return session
    },
  },
  pages: { signIn: '/login' },
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET,
}
