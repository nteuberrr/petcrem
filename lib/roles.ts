/**
 * Modelo de roles del sistema (3 niveles).
 *
 *  - admin     → poder total: todo, incluida "Configuración Avanzada" y el informe de accesos.
 *  - admin2    → igual que admin EXCEPTO "Configuración Avanzada"; en Usuarios solo gestiona operadores.
 *  - operador  → acceso restringido (dashboard, clientes, operaciones, asistencia).
 *
 * Fuente única usada por proxy.ts, lib/auth, la API de usuarios y la UI.
 */

export type Rol = 'admin' | 'admin2' | 'operador'

export const ROLES: { value: Rol; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'admin2', label: 'General' },
  { value: 'operador', label: 'Operador' },
]

export const ROL_LABEL: Record<string, string> = {
  admin: 'Admin', admin2: 'General', operador: 'Operador',
}

/** Normaliza un valor arbitrario a un Rol válido (default operador). */
export function normalizarRol(r: unknown): Rol {
  return r === 'admin' || r === 'admin2' ? r : 'operador'
}

/** Nivel 1: poder total (Configuración Avanzada + informe de accesos). */
export function esAdminTotal(r?: string | null): boolean {
  return r === 'admin'
}

/** Acceso amplio: admin o admin2 (todo menos Configuración Avanzada para admin2). */
export function esAdmin(r?: string | null): boolean {
  return r === 'admin' || r === 'admin2'
}

/** Solo admin (1) puede entrar a Configuración Avanzada. */
export function puedeConfigAvanzada(r?: string | null): boolean {
  return r === 'admin'
}

/** Prefijos de API que SOLO el admin (1) puede tocar (backend de Configuración Avanzada). */
export const APIS_AVANZADAS = ['/api/empresa-config', '/api/mensajes/agente', '/api/sync-database', '/api/correos', '/api/usuarios', '/api/permisos']

export function esApiAvanzada(pathname: string): boolean {
  return APIS_AVANZADAS.some(p => pathname.startsWith(p))
}

/**
 * Matriz de accesos por módulo → roles permitidos. Es la fuente del "informe de
 * accesos" (Usuarios, solo admin). Mantener actualizada al sumar módulos nuevos.
 */
export interface ModuloAcceso { modulo: string; roles: Rol[]; nota?: string }
export const MATRIZ_ACCESOS: ModuloAcceso[] = [
  { modulo: 'Dashboard', roles: ['admin', 'admin2', 'operador'] },
  { modulo: 'Clientes', roles: ['admin', 'admin2', 'operador'] },
  { modulo: 'Operaciones (ciclos, petróleo, vehículo, despachos)', roles: ['admin', 'admin2', 'operador'] },
  { modulo: 'Asistencia', roles: ['admin', 'admin2', 'operador'] },
  { modulo: 'Mensajes (inbox WhatsApp)', roles: ['admin', 'admin2'] },
  { modulo: 'Rendiciones', roles: ['admin', 'admin2'] },
  { modulo: 'Veterinarios (Bases)', roles: ['admin', 'admin2'] },
  { modulo: 'Servicios (Eutanasias a domicilio)', roles: ['admin', 'admin2'] },
  { modulo: 'Campañas (FB/IG/TikTok/Mail)', roles: ['admin'], nota: 'Solo el administrador principal.' },
  { modulo: 'Estado de Resultados (EERR)', roles: ['admin'], nota: 'Solo el administrador principal.' },
  { modulo: 'Reportes', roles: ['admin', 'admin2'] },
  { modulo: 'Configuración · Precios', roles: ['admin', 'admin2'] },
  { modulo: 'Configuración · Artículos (Servicios, Bodega, Otros Productos)', roles: ['admin', 'admin2'] },
  { modulo: 'Configuración · Descuentos', roles: ['admin', 'admin2'] },
  { modulo: 'Configuración · Jornada', roles: ['admin', 'admin2'] },
  { modulo: 'Configuración Avanzada · Datos Personales', roles: ['admin'] },
  { modulo: 'Configuración Avanzada · Usuarios', roles: ['admin'], nota: 'Solo el administrador principal.' },
  { modulo: 'Configuración Avanzada · Agentes (IA)', roles: ['admin'] },
  { modulo: 'Configuración Avanzada · Correos', roles: ['admin'] },
  { modulo: 'Configuración Avanzada · Mantenimiento', roles: ['admin'] },
  { modulo: 'Informe de accesos', roles: ['admin'] },
]
