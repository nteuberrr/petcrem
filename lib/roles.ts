/**
 * Modelo de roles del sistema (4 niveles).
 *
 *  - admin      → poder total: todo, incluida "Configuración Avanzada" y el informe de accesos.
 *  - admin2     → igual que admin EXCEPTO "Configuración Avanzada"; en Usuarios solo gestiona operarios.
 *  - operador   → Operario Nivel 1: acceso restringido (dashboard, clientes, operaciones, asistencia).
 *  - operador2  → Operario Nivel 2: mismos permisos base que el Nivel 1, pero gobernado por su
 *                 propia columna en el editor de permisos para poder diferenciarlos después.
 *
 * Fuente única usada por proxy.ts, lib/auth, la API de usuarios y la UI.
 */

export type Rol = 'admin' | 'admin2' | 'operador' | 'operador2'

export const ROLES: { value: Rol; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'admin2', label: 'General' },
  { value: 'operador', label: 'Operario Nivel 1' },
  { value: 'operador2', label: 'Operario Nivel 2' },
]

export const ROL_LABEL: Record<string, string> = {
  admin: 'Admin', admin2: 'General', operador: 'Operario Nivel 1', operador2: 'Operario Nivel 2',
}

/** Normaliza un valor arbitrario a un Rol válido (default operador = Nivel 1). */
export function normalizarRol(r: unknown): Rol {
  return r === 'admin' || r === 'admin2' || r === 'operador2' ? r : 'operador'
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
export const APIS_AVANZADAS = ['/api/empresa-config', '/api/mensajes/agente', '/api/correos', '/api/avisos', '/api/usuarios', '/api/permisos', '/api/perfiles', '/api/uso-ia']

export function esApiAvanzada(pathname: string): boolean {
  return APIS_AVANZADAS.some(p => pathname.startsWith(p))
}

/**
 * ⚠️ La matriz de accesos por módulo ya NO vive acá: la fuente única es el
 * registro `MODULOS` de lib/permisos.ts y los PERFILES guardados en la base
 * (editables en Configuración Avanzada → Usuarios → Perfiles). La constante
 * `MATRIZ_ACCESOS` se eliminó porque se mantenía a mano y quedó desactualizada
 * respecto del gateo real.
 */
