/**
 * Motor de permisos DINÁMICO por módulo × rol (editable desde la UI, aplica casi
 * al instante). Reemplaza el gateo hardcodeado de admin2/operador en proxy.ts.
 *
 *  - El admin (dueño) SIEMPRE tiene todo (no se edita → no puede auto-bloquearse).
 *  - admin2 ("General") y operador se gobiernan por la tabla `permisos_modulos`.
 *  - Configuración Avanzada (APIS_AVANZADAS) queda SIEMPRE solo del admin (acá vive
 *    el editor de permisos → no es toggleable, para evitar escalar privilegios).
 *
 * Apto para middleware (edge): lee Supabase por REST con `fetch` (sin supabase-js
 * ni datastore, que arrastrarían googleapis y romperían el bundle del edge).
 */

import { APIS_AVANZADAS } from './roles'

export type RolEditable = 'admin2' | 'operador'

export interface Modulo {
  key: string
  label: string
  /** Prefijos de páginas que cubre el módulo. */
  pages: string[]
  /** Prefijos de API que cubre el módulo. */
  apis: string[]
  /** Acceso por defecto (= comportamiento actual antes de editar). */
  def: { admin2: boolean; operador: boolean }
}

/**
 * Registro ÚNICO de módulos. Los `def` reproducen EXACTAMENTE el gateo actual, así
 * nada cambia hasta que el admin edita. Los prefijos compartidos (ej. /api/precios
 * lo usan clientes y configuración) se listan en cada módulo que los necesita: el
 * acceso se concede si CUALQUIER módulo concedido (de máxima especificidad) los cubre.
 */
export const MODULOS: Modulo[] = [
  { key: 'dashboard', label: 'Dashboard', pages: ['/dashboard'], apis: ['/api/dashboard'], def: { admin2: true, operador: true } },
  { key: 'clientes', label: 'Clientes', pages: ['/clientes'], apis: ['/api/clientes', '/api/upload', '/api/places', '/api/veterinarios', '/api/precios', '/api/descuentos', '/api/especies', '/api/productos', '/api/servicios'], def: { admin2: true, operador: true } },
  { key: 'operaciones', label: 'Operaciones', pages: ['/operaciones'], apis: ['/api/ciclos', '/api/petroleo', '/api/vehiculo', '/api/despachos'], def: { admin2: true, operador: true } },
  { key: 'asistencia', label: 'Asistencia', pages: ['/asistencia'], apis: ['/api/asistencia', '/api/jornada-config', '/api/retiros-adicionales'], def: { admin2: true, operador: true } },
  { key: 'mensajes', label: 'Mensajes', pages: ['/mensajes'], apis: ['/api/mensajes', '/api/solicitudes-retiro'], def: { admin2: true, operador: false } },
  { key: 'rendiciones', label: 'Rendiciones', pages: ['/rendiciones'], apis: ['/api/rendiciones'], def: { admin2: true, operador: false } },
  { key: 'bases', label: 'Veterinarios (Bases)', pages: ['/bases'], apis: ['/api/veterinarios'], def: { admin2: true, operador: false } },
  { key: 'servicios', label: 'Servicios (Eutanasias)', pages: ['/servicios'], apis: ['/api/eutanasias', '/api/servicios'], def: { admin2: true, operador: false } },
  { key: 'reportes', label: 'Reportes', pages: ['/reportes'], apis: ['/api/reportes'], def: { admin2: true, operador: false } },
  { key: 'configuracion', label: 'Configuración (Precios, Artículos, Descuentos, Jornada)', pages: ['/configuracion'], apis: ['/api/precios', '/api/productos', '/api/especies', '/api/servicios', '/api/descuentos', '/api/tipos-servicio', '/api/jornada-config'], def: { admin2: true, operador: false } },
  { key: 'mailing', label: 'Campañas (Mail / Instagram / Facebook)', pages: ['/mailing'], apis: ['/api/mailing'], def: { admin2: false, operador: false } },
  { key: 'eerr', label: 'Estado de Resultados', pages: ['/estado-resultados'], apis: ['/api/eerr'], def: { admin2: false, operador: false } },
]

export type PermisosConfig = Record<string, { admin2: boolean; operador: boolean }>

/** Config por defecto (lo que está en MODULOS.def). */
export function defaultPermisos(): PermisosConfig {
  const out: PermisosConfig = {}
  for (const m of MODULOS) out[m.key] = { admin2: m.def.admin2, operador: m.def.operador }
  return out
}

/** ¿La ruta pertenece a Configuración Avanzada (siempre solo admin)? */
export function esRutaAvanzada(pathname: string): boolean {
  return APIS_AVANZADAS.some(p => pathname === p || pathname.startsWith(p + '/') || pathname.startsWith(p))
}

function matchLen(pathname: string, prefijos: string[]): number {
  let best = -1
  for (const p of prefijos) {
    if (pathname === p || pathname.startsWith(p + '/')) best = Math.max(best, p.length)
  }
  return best
}

/**
 * Devuelve los módulos de MÁXIMA especificidad que cubren la ruta (o [] si ninguno).
 * Máxima especificidad = prefijo coincidente más largo (para que /api/mensajes/agente
 * gane sobre /api/mensajes; ese caso igual lo corta esRutaAvanzada antes).
 */
export function modulosDeRuta(pathname: string): Modulo[] {
  let best = -1
  let ganadores: Modulo[] = []
  for (const m of MODULOS) {
    const len = Math.max(matchLen(pathname, m.pages), matchLen(pathname, m.apis))
    if (len < 0) continue
    if (len > best) { best = len; ganadores = [m] }
    else if (len === best) ganadores.push(m)
  }
  return ganadores
}

/**
 * Decide si un rol puede acceder a la ruta según la config dinámica.
 * - matched=false → fallback que reproduce hoy: admin2 permite, operador no.
 * - matched=true → permite si ALGÚN módulo ganador está concedido para ese rol.
 */
export function puedeAcceder(rol: RolEditable, pathname: string, config: PermisosConfig): boolean {
  const mods = modulosDeRuta(pathname)
  if (mods.length === 0) return rol === 'admin2'
  return mods.some(m => (config[m.key]?.[rol]) ?? m.def[rol])
}

// ─── Lectura de la config desde Supabase (REST, edge-safe, cacheada) ──────────

const TTL_MS = 5000 // cambios visibles en ~5s sin pegarle a la base en cada request
let cache: { data: PermisosConfig; exp: number } | null = null

export async function getPermisosConfig(): Promise<PermisosConfig> {
  if (cache && Date.now() < cache.exp) return cache.data
  const base = defaultPermisos()
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) { cache = { data: base, exp: Date.now() + TTL_MS }; return base }
  try {
    const res = await fetch(`${url}/rest/v1/permisos_modulos?select=modulo,rol,permitido`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    if (res.ok) {
      const rows = (await res.json()) as Array<{ modulo: string; rol: string; permitido: string }>
      for (const r of rows) {
        if (!base[r.modulo]) continue
        if (r.rol === 'admin2' || r.rol === 'operador') {
          base[r.modulo][r.rol] = /^(true|verdadero|1)$/i.test((r.permitido || '').trim())
        }
      }
    }
  } catch {
    // Si falla la lectura, caemos a los defaults (no rompemos el acceso).
  }
  cache = { data: base, exp: Date.now() + TTL_MS }
  return base
}

/** Invalida el cache (lo llama el editor tras guardar para acelerar el efecto). */
export function invalidarPermisosCache(): void {
  cache = null
}

/** Claves de módulos que el rol puede ver (para el sidebar). admin ve todos. */
export function modulosPermitidos(rol: string, config: PermisosConfig): Set<string> {
  if (rol === 'admin') return new Set(MODULOS.map(m => m.key))
  const r: RolEditable | null = rol === 'admin2' ? 'admin2' : rol === 'operador' ? 'operador' : null
  if (!r) return new Set()
  return new Set(MODULOS.filter(m => (config[m.key]?.[r] ?? m.def[r])).map(m => m.key))
}
