import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getPermisosSnapshot, modulosPermitidos, nivelesDeActor } from '@/lib/permisos'

/**
 * GET /api/mis-modulos  (cualquier usuario logueado)
 * Devuelve los módulos que el usuario actual puede ver y con qué nivel, para que
 * el Sidebar muestre solo lo permitido y las pantallas puedan pasar a modo
 * solo-lectura. Refleja la config dinámica (~instantáneo).
 *
 *   { modulos: string[], niveles: { [modulo]: 'none'|'ver'|'editar' } }
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  const user = session?.user as { role?: string; id?: string; perfilId?: string } | undefined
  if (!user?.role) return NextResponse.json({ modulos: [], niveles: {} }, { status: 401 })
  const actor = { rol: user.role, usuarioId: user.id, perfilId: user.perfilId }
  const snap = await getPermisosSnapshot()
  return NextResponse.json({
    modulos: [...modulosPermitidos(actor, snap)],
    niveles: nivelesDeActor(actor, snap),
  })
}
