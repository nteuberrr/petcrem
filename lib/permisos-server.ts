/**
 * Gate de permisos DINÁMICO para route handlers (Node runtime). Espeja EXACTAMENTE
 * la lógica del proxy (lib/permisos + proxy.ts): así una API deja de bloquear con
 * un `esAdmin` hardcodeado y pasa a respetar los perfiles. Sin esto, activar un
 * módulo para un perfil dejaba entrar a la PÁGINA pero sus APIs seguían devolviendo
 * 403 → todo en 0 (caso Servicios/Eutanasias, y después Facturación).
 *
 * El proxy ya corta la mayoría de los casos; estos helpers son la segunda barrera
 * (defensa en profundidad) y el único lugar donde una ruta puede pedir un nivel
 * distinto al que deduce el método HTTP.
 *
 * NO importar este archivo desde el edge (proxy) — arrastra authOptions/googleapis.
 * El proxy usa lib/permisos directo; esto es solo para los handlers.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from './auth'
import {
  alcanza, esRutaAvanzada, getPermisosSnapshot, nivelDeModulo, nivelDeMetodo,
  puedeAcceder, type Actor, type Nivel,
} from './permisos'

export interface SesionUsuario {
  user?: { role?: string; id?: string; perfilId?: string; name?: string; email?: string }
}

function actorDe(session: SesionUsuario | null): Actor {
  return {
    rol: session?.user?.role ?? null,
    usuarioId: session?.user?.id ?? null,
    perfilId: session?.user?.perfilId ?? null,
  }
}

/**
 * ¿La sesión actual puede acceder a `pathname` con este método?
 *  - admin (dueño): siempre.
 *  - Configuración Avanzada (APIS_AVANZADAS): siempre SOLO admin.
 *  - el resto: según el perfil (y su excepción por usuario, si tiene).
 * Devuelve también la sesión para reusarla en el handler (creado_por, etc.).
 */
export async function sesionConAcceso(
  pathname: string,
  method: string = 'GET',
): Promise<{ ok: boolean; session: SesionUsuario | null; role: string | null }> {
  const session = (await getServerSession(authOptions)) as SesionUsuario | null
  const role = session?.user?.role ?? null
  if (!role) return { ok: false, session: null, role: null }
  if (role === 'admin') return { ok: true, session, role }
  if (esRutaAvanzada(pathname)) return { ok: false, session, role }
  const snap = await getPermisosSnapshot()
  return { ok: puedeAcceder(actorDe(session), pathname, method, snap), session, role }
}

/**
 * Nivel que la sesión tiene sobre un módulo concreto (`none` | `ver` | `editar`).
 * Para las rutas que sirven a varias secciones o que quieren degradar la respuesta
 * en vez de rechazarla (ej. devolver solo lo propio a un visualizador).
 */
export async function nivelDeSesion(
  modulo: string,
): Promise<{ nivel: Nivel; session: SesionUsuario | null; role: string | null }> {
  const session = (await getServerSession(authOptions)) as SesionUsuario | null
  const role = session?.user?.role ?? null
  if (!role) return { nivel: 'none', session: null, role: null }
  const snap = await getPermisosSnapshot()
  return { nivel: nivelDeModulo(actorDe(session), modulo, snap), session, role }
}

/**
 * ¿La sesión alcanza este nivel sobre el módulo? Es el reemplazo directo de los
 * `esAdmin(role)` / `esAdminTotal(role)` hardcodeados en los route handlers:
 *
 *   -  if (!esAdminTotal(user?.role)) return 403
 *   +  if (!(await puedeNivel('facturacion', 'editar'))) return 403
 */
export async function puedeNivel(modulo: string, requerido: Nivel = 'ver'): Promise<boolean> {
  const { nivel } = await nivelDeSesion(modulo)
  return alcanza(nivel, requerido)
}

/** ¿La sesión puede EDITAR el módulo? Atajo de lectura frecuente. */
export async function puedeEditar(modulo: string): Promise<boolean> {
  return puedeNivel(modulo, 'editar')
}

/**
 * Guard de una línea para un handler: exige un nivel sobre un módulo y devuelve
 * la respuesta 403 lista si no alcanza.
 *
 *   const g = await exigirNivel('facturacion', 'editar')
 *   if (g.denegado) return g.denegado
 */
export async function exigirNivel(
  modulo: string,
  requerido: Nivel | { method: string } = 'ver',
): Promise<{ denegado: NextResponse | null; nivel: Nivel; session: SesionUsuario | null; role: string | null }> {
  const nivelPedido: Nivel = typeof requerido === 'string' ? requerido : nivelDeMetodo(requerido.method)
  const { nivel, session, role } = await nivelDeSesion(modulo)
  if (!role) {
    return { denegado: NextResponse.json({ error: 'No autenticado' }, { status: 401 }), nivel, session, role }
  }
  if (!alcanza(nivel, nivelPedido)) {
    const msg = nivelPedido === 'editar' && nivel === 'ver'
      ? 'Tu perfil puede ver esta sección, pero no modificarla.'
      : 'No autorizado'
    return { denegado: NextResponse.json({ error: msg }, { status: 403 }), nivel, session, role }
  }
  return { denegado: null, nivel, session, role }
}
