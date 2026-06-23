'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'
import { useState, useEffect } from 'react'

// Cada ítem se asocia a un módulo; el sidebar muestra solo los módulos permitidos
// para el rol (dinámico, vía /api/mis-modulos). El admin (dueño) ve todos.
const nav: { href: string; label: string; icon: string; modulo: string }[] = [
  { href: '/dashboard', label: 'Dashboard', icon: '📊', modulo: 'dashboard' },
  { href: '/clientes', label: 'Clientes', icon: '🐾', modulo: 'clientes' },
  { href: '/mensajes', label: 'Mensajes', icon: '💬', modulo: 'mensajes' },
  { href: '/operaciones', label: 'Operaciones', icon: '🔥', modulo: 'operaciones' },
  { href: '/asistencia', label: 'Asistencia', icon: '🕐', modulo: 'asistencia' },
  { href: '/rendiciones', label: 'Rendiciones', icon: '🧾', modulo: 'rendiciones' },
  { href: '/bases', label: 'Veterinarios', icon: '🏥', modulo: 'bases' },
  { href: '/servicios', label: 'Servicios', icon: '🤝', modulo: 'servicios' },
  { href: '/mailing', label: 'Campañas', icon: '📣', modulo: 'mailing' },
  { href: '/estado-resultados', label: 'Estado de Resultados', icon: '💰', modulo: 'eerr' },
  { href: '/configuracion', label: 'Configuración', icon: '⚙️', modulo: 'configuracion' },
  { href: '/reportes', label: 'Reportes', icon: '📈', modulo: 'reportes' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const userName = session?.user?.name ?? session?.user?.email ?? ''
  const role = session?.user?.role ?? 'operador'
  const initials = userName.slice(0, 2).toUpperCase()
  const [open, setOpen] = useState(false)
  // Módulos permitidos para este usuario (dinámico). null = cargando.
  const [allowed, setAllowed] = useState<Set<string> | null>(null)

  useEffect(() => {
    let cancel = false
    fetch('/api/mis-modulos')
      .then(r => (r.ok ? r.json() : { modulos: [] }))
      .then(d => { if (!cancel) setAllowed(new Set<string>(Array.isArray(d.modulos) ? d.modulos : [])) })
      .catch(() => { if (!cancel) setAllowed(new Set<string>()) })
    return () => { cancel = true }
  }, [])

  // Mientras carga, mostramos solo Dashboard (evita parpadeo de ítems no permitidos).
  const items = allowed ? nav.filter(n => allowed.has(n.modulo)) : nav.filter(n => n.modulo === 'dashboard')

  // Cerrar el menú al navegar en móvil
  useEffect(() => { setOpen(false) }, [pathname])

  return (
    <>
      {/* Botón hamburguesa (solo móvil) */}
      <button
        aria-label="Abrir menú"
        onClick={() => setOpen(true)}
        className="md:hidden fixed top-3 left-3 z-30 w-10 h-10 rounded-lg bg-gray-900 text-white flex items-center justify-center shadow-lg"
      >
        <span className="text-xl leading-none">☰</span>
      </button>

      {/* Overlay oscuro cuando el menú está abierto en móvil */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          className="md:hidden fixed inset-0 bg-black/50 z-30"
          aria-hidden="true"
        />
      )}

      <aside
        className={`w-60 bg-gray-900 text-white flex flex-col min-h-screen fixed left-0 top-0 z-40 transition-transform duration-200 ${
          open ? 'translate-x-0' : '-translate-x-full'
        } md:translate-x-0`}
      >
        <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-alma-animal.png" alt="Alma Animal" className="h-12 w-auto shrink-0" />
          <Link href="/dashboard" className="block flex-1 hover:opacity-80 transition-opacity">
            <h1 className="text-lg font-bold tracking-tight">Alma Animal</h1>
            <p className="text-gray-400 text-xs mt-0.5">Gestión crematorio</p>
          </Link>
          <button
            aria-label="Cerrar menú"
            onClick={() => setOpen(false)}
            className="md:hidden w-8 h-8 rounded-md hover:bg-gray-800 text-gray-400 text-xl leading-none"
          >
            ×
          </button>
        </div>
        <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
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
    </>
  )
}
