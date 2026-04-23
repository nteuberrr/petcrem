'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'

const nav = [
  { href: '/dashboard', label: 'Dashboard', icon: '📊', adminOnly: true },
  { href: '/clientes', label: 'Clientes', icon: '🐾', adminOnly: false },
  { href: '/operaciones', label: 'Operaciones', icon: '🔥', adminOnly: false },
  { href: '/rendiciones', label: 'Rendiciones', icon: '🧾', adminOnly: true },
  { href: '/bases', label: 'Bases de datos', icon: '🗄️', adminOnly: true },
  { href: '/configuracion', label: 'Configuración', icon: '⚙️', adminOnly: true },
  { href: '/reportes', label: 'Reportes', icon: '📈', adminOnly: true },
]

export default function Sidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const userName = session?.user?.name ?? session?.user?.email ?? ''
  const role = session?.user?.role ?? 'operador'
  const isAdmin = role === 'admin'
  const initials = userName.slice(0, 2).toUpperCase()
  const items = nav.filter(n => !n.adminOnly || isAdmin)

  return (
    <aside className="w-60 bg-gray-900 text-white flex flex-col min-h-screen fixed left-0 top-0 z-10">
      <Link href="/dashboard" className="px-6 py-5 border-b border-gray-800 block hover:bg-gray-800 transition-colors">
        <h1 className="text-lg font-bold tracking-tight">Alma Animal</h1>
        <p className="text-gray-400 text-xs mt-0.5">Gestión crematorio</p>
      </Link>
      <nav className="flex-1 py-4 px-3 space-y-0.5">
        {items.map(({ href, label, icon }) => {
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
            <div className="min-w-0 flex-1">
              <div className="text-xs text-gray-300 truncate">{userName}</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wide">{role}</div>
            </div>
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
