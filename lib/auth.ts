import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { getSheetData } from '@/lib/google-sheets'

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credenciales',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Contraseña', type: 'password' },
      },
      async authorize(credentials) {
        // Admin from env always works
        if (
          credentials?.email === process.env.ADMIN_EMAIL &&
          credentials?.password === process.env.ADMIN_PASSWORD
        ) {
          return { id: '0', name: 'Administrador', email: credentials!.email, role: 'admin' }
        }
        // Check usuarios sheet
        try {
          const usuarios = await getSheetData('usuarios')
          const u = usuarios.find(
            u => u.email === credentials?.email &&
                 u.password === credentials?.password &&
                 u.activo === 'TRUE'
          )
          if (u) return { id: u.id, name: u.nombre, email: u.email, role: u.rol ?? 'operador' }
        } catch {}
        return null
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: string }).role ?? 'operador'
        token.id = (user as { id?: string }).id ?? ''
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
