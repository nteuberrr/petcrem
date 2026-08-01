/**
 * Guard compartido de las rutas de Remuneraciones.
 *
 * Va por el modelo de perfiles (lib/permisos-server), NO por `esAdminTotal`
 * hardcodeado: si se gateara por rol, activar el módulo para un perfil abriría
 * la página pero sus APIs seguirían devolviendo 403.
 *
 * Que hoy solo entre el dueño no lo decide este archivo, sino el registro de
 * módulos: `remuneraciones` arranca en `none` para todos los perfiles y el admin
 * (dueño) siempre tiene todo. Si mañana el dueño le da el módulo a un perfil
 * —un contador, por ejemplo—, funciona sin tocar código: `ver` deja mirar y
 * `editar` deja calcular, cerrar y pagar.
 */
import { exigirNivel } from '@/lib/permisos-server'
import type { NextResponse } from 'next/server'

export const MODULO = 'remuneraciones'

export interface Actor {
  id: string
  nombre: string
}

export interface Guard {
  /** Respuesta 401/403 lista para devolver, o `null` si tiene acceso. */
  denegado: NextResponse | null
  actor: Actor
}

/**
 * Exige nivel sobre el módulo. `'ver'` para los GET, `'editar'` para lo que
 * escribe (calcular, cerrar, pagar, alta de empleados y parámetros).
 */
export async function guard(requerido: 'ver' | 'editar' = 'ver'): Promise<Guard> {
  const { denegado, session } = await exigirNivel(MODULO, requerido)
  const user = session?.user as { id?: string; name?: string } | undefined
  return {
    denegado,
    actor: { id: String(user?.id || ''), nombre: String(user?.name || '') },
  }
}
