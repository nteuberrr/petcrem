'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'
import { useState, useEffect } from 'react'
import {
  LayoutDashboard, PawPrint, MessageCircle, Flame, Clock, Receipt, Stethoscope,
  HeartHandshake, Megaphone, FileText, Globe, Wallet, Settings, LineChart,
  Menu, X, LogOut, type LucideIcon,
} from 'lucide-react'

// Cada ítem se asocia a un módulo; el sidebar muestra solo los módulos permitidos
// para el rol (dinámico, vía /api/mis-modulos). El admin (dueño) ve todos.
// `color` es la clase de color SOLO del icono en reposo (sobre el navy del sidebar);
// cuando el ítem está activo el icono pasa a navy para verse sobre el pill dorado.
const nav: { href: string; label: string; icon: LucideIcon; modulo: string; color: string }[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, modulo: 'dashboard', color: 'text-sky-400' },
  { href: '/clientes', label: 'Clientes', icon: PawPrint, modulo: 'clientes', color: 'text-amber-400' },
  { href: '/mensajes', label: 'Mensajes', icon: MessageCircle, modulo: 'mensajes', color: 'text-emerald-400' },
  { href: '/operaciones', label: 'Operaciones', icon: Flame, modulo: 'operaciones', color: 'text-orange-400' },
  { href: '/asistencia', label: 'Asistencia', icon: Clock, modulo: 'asistencia', color: 'text-cyan-400' },
  { href: '/rendiciones', label: 'Rendiciones', icon: Receipt, modulo: 'rendiciones', color: 'text-yellow-300' },
  { href: '/bases', label: 'Veterinarios', icon: Stethoscope, modulo: 'bases', color: 'text-teal-300' },
  { href: '/servicios', label: 'Eutanasias', icon: HeartHandshake, modulo: 'servicios', color: 'text-rose-400' },
  { href: '/mailing', label: 'Marketing', icon: Megaphone, modulo: 'mailing', color: 'text-fuchsia-400' },
  { href: '/facturacion', label: 'Facturación', icon: FileText, modulo: 'facturacion', color: 'text-blue-400' },
  { href: '/web', label: 'Web', icon: Globe, modulo: 'web', color: 'text-violet-400' },
  { href: '/estado-resultados', label: 'Estado de Resultados', icon: Wallet, modulo: 'eerr', color: 'text-green-400' },
  { href: '/configuracion', label: 'Configuración', icon: Settings, modulo: 'configuracion', color: 'text-slate-300' },
  { href: '/reportes', label: 'Reportes', icon: LineChart, modulo: 'reportes', color: 'text-purple-400' },
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
  // Solicitudes de retiro del bot pendientes (badge en "Mensajes"). Se refresca solo.
  const [pendientes, setPendientes] = useState(0)
  // Eutanasias "sobre la marcha" (no cerradas / no pagadas) → badge en "Eutanasias".
  const [eutanasias, setEutanasias] = useState(0)
  // Chats sin leer → "(N)" en el ítem "Mensajes".
  const [noLeidos, setNoLeidos] = useState(0)

  useEffect(() => {
    let cancel = false
    fetch('/api/mis-modulos')
      .then(r => (r.ok ? r.json() : { modulos: [] }))
      .then(d => { if (!cancel) setAllowed(new Set<string>(Array.isArray(d.modulos) ? d.modulos : [])) })
      .catch(() => { if (!cancel) setAllowed(new Set<string>()) })
    return () => { cancel = true }
  }, [])

  useEffect(() => {
    if (!allowed?.has('mensajes')) return
    let cancel = false
    const cargar = () => {
      fetch('/api/solicitudes-retiro', { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : { pendientes: [] }))
        .then((d: { pendientes?: unknown[] }) => { if (!cancel) setPendientes(Array.isArray(d?.pendientes) ? d.pendientes.length : 0) })
        .catch(() => {})
      fetch('/api/mensajes/no-leidos-count', { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : { count: 0 }))
        .then((d: { count?: number }) => { if (!cancel) setNoLeidos(typeof d?.count === 'number' ? d.count : 0) })
        .catch(() => {})
    }
    cargar()
    const t = setInterval(cargar, 30000)
    return () => { cancel = true; clearInterval(t) }
  }, [allowed])

  useEffect(() => {
    if (!allowed?.has('servicios')) return
    let cancel = false
    const cargar = () => fetch('/api/eutanasias/pendientes-count', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : { count: 0 }))
      .then((d: { count?: number }) => { if (!cancel) setEutanasias(typeof d?.count === 'number' ? d.count : 0) })
      .catch(() => {})
    cargar()
    const t = setInterval(cargar, 30000)
    return () => { cancel = true; clearInterval(t) }
  }, [allowed])

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
        className="md:hidden fixed top-3 left-3 z-30 w-10 h-10 rounded-lg bg-brand text-white flex items-center justify-center shadow-lg"
      >
        <Menu className="w-5 h-5" aria-hidden="true" />
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
        className={`w-60 bg-gradient-to-b from-[#15436F] to-[#0B2845] text-white flex flex-col min-h-screen fixed left-0 top-0 z-40 transition-transform duration-200 shadow-xl ${
          open ? 'translate-x-0' : '-translate-x-full'
        } md:translate-x-0`}
      >
        <div className="flex items-center gap-3 px-6 py-5 border-b border-white/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-alma-animal.png" alt="Alma Animal" className="h-12 w-auto shrink-0" />
          <Link href="/dashboard" className="block flex-1 hover:opacity-80 transition-opacity">
            <h1 className="text-lg font-bold tracking-tight">Alma Animal</h1>
            <p className="text-white/90 text-xs mt-0.5">Gestión crematorio</p>
          </Link>
          <button
            aria-label="Cerrar menú"
            onClick={() => setOpen(false)}
            className="md:hidden w-8 h-8 rounded-md hover:bg-white/15 text-white/90 flex items-center justify-center"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
          {items.map(({ href, label, icon: Icon, color }) => {
            const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  active
                    ? 'bg-gold text-brand font-semibold shadow-sm'
                    : 'text-white/80 font-medium hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon className={`w-5 h-5 shrink-0 ${active ? 'text-brand' : color}`} aria-hidden="true" />
                <span className="flex-1">{label}{href === '/mensajes' && noLeidos > 0 ? ` (${noLeidos})` : ''}</span>
                {href === '/mensajes' && pendientes > 0 && (
                  <span className="min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                    {pendientes}
                  </span>
                )}
                {href === '/servicios' && eutanasias > 0 && (
                  <span className="min-w-5 h-5 px-1.5 rounded-full bg-orange-500 text-white text-[11px] font-bold flex items-center justify-center shrink-0" title="Eutanasias sobre la marcha (no cerradas / no pagadas)">
                    {eutanasias}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>
        <div className="p-3 border-t border-white/10">
          {userName && (
            <div className="flex items-center gap-3 px-3 py-2 mb-1">
              <div className="w-7 h-7 rounded-full bg-gold flex items-center justify-center text-xs font-bold text-brand shrink-0">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs text-white/90 truncate">{userName}</div>
                <div className="text-[10px] text-white/50 uppercase tracking-wide">{role}</div>
              </div>
            </div>
          )}
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="w-full text-left text-sm text-white/90 hover:text-white px-3 py-2 rounded-lg hover:bg-white/15 transition-colors flex items-center gap-2"
          >
            <LogOut className="w-4 h-4 shrink-0" aria-hidden="true" />
            Cerrar sesión
          </button>
        </div>
      </aside>
    </>
  )
}
