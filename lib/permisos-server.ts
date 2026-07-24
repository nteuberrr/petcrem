/**
 * Gate de permisos DINÁMICO para route handlers (Node runtime). Espeja EXACTAMENTE
 * la lógica del proxy (lib/permisos + proxy.ts): así una API deja de bloquear con
 * un `esAdmin` hardcodeado y pasa a respetar el editor "Permisos por rol". Sin esto,
 * activar un módulo para admin2/operador/operador2 dejaba entrar a la PÁGINA pero
 * sus APIs seguían devolviendo 403 → todo en 0 (caso Servicios/Eutanasias).
 *
 * NO importar este archivo desde el edge (proxy) — arrastra authOptions/googleapis.
 * El proxy usa lib/permisos directo; esto es solo para los handlers.
 */
import { getServerSession } from 'next-auth/next'
import { authOptions } from './auth'
import { normalizarRol } from './roles'
import { getPermisosConfig, puedeAcceder, esRutaAvanzada } from './permisos'

export interface SesionUsuario { user?: { role?: string; id?: string; name?: string; email?: string } }

/**
 * ¿La sesión actual puede acceder a `pathname` según los permisos dinámicos?
 *  - admin (dueño): siempre.
 *  - Configuración Avanzada (APIS_AVANZADAS): siempre SOLO admin.
 *  - admin2 / operador / operador2: según el editor de permisos por módulo.
 * Devuelve también la sesión para reusarla en el handler (creado_por, etc.).
 */
export async function sesionConAcceso(
  pathname: string,
): Promise<{ ok: boolean; session: SesionUsuario | null; role: string | null }> {
  const session = (await getServerSession(authOptions)) as SesionUsuario | null
  const role = session?.user?.role ?? null
  if (!role) return { ok: false, session: null, role: null }
  if (role === 'admin') return { ok: true, session, role }
  if (esRutaAvanzada(pathname)) return { ok: false, session, role }
  const norm = normalizarRol(role)
  if (norm === 'admin2' || norm === 'operador' || norm === 'operador2') {
    const config = await getPermisosConfig()
    return { ok: puedeAcceder(norm, pathname, config), session, role }
  }
  return { ok: false, session, role }
}
