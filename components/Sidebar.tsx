'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'

const nav = [
  { href: '/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/clientes', label: 'Clientes', icon: '🐾' },
  { href: '/operaciones', label: 'Operaciones', icon: '🔥' },
  { href: '/bases', label: 'Bases de datos', icon: '🗄️' },
  { href: '/configuracion', label: 'Configuración', icon: '⚙️' },
  { href: '/reportes', label: 'Reportes', icon: '📈' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const userName = session?.user?.name ?? session?.user?.email ?? ''
  const initials = userName.slice(0, 2).toUpperCase()

  return (
    <aside className="w-60 bg-gray-900 text-white flex flex-col min-h-screen fixed left-0 top-0 z-10">
      <Link href="/dashboard" className="px-6 py-5 border-b border-gray-800 block hover:bg-gray-800 transition-colors">
        <h1 className="text-lg font-bold tracking-tight">Alma Animal</h1>
        <p className="text-gray-400 text-xs mt-0.5">Gestión crematorio</p>
      </Link>
      <nav className="flex-1 py-4 px-3 space-y-0.5">
        {nav.map(({ href, label, icon }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <span className="text-base">{icon}</span>
              {label}
            </Link>
          )
        })}
      </nav>
      <div className="p-3 border-t border-gray-800">
        {userName && (
          <div className="flex items-center gap-3 px-3 py-2 mb-1">
            <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold text-white shrink-0">
              {initials}
            </div>
            <span className="text-xs text-gray-400 truncate">{userName}</span>
          </div>
        )}
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="w-full text-left text-sm text-gray-400 hover:text-white px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors flex items-center gap-2"
        >
          <span className="text-sm">↩</span>
          Cerrar sesión
        </button>
      </div>
    </aside>
  )
}
