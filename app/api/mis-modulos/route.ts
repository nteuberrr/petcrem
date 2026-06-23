import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getPermisosConfig, modulosPermitidos } from '@/lib/permisos'

/**
 * GET /api/mis-modulos  (cualquier usuario logueado)
 * Devuelve las claves de módulos que el usuario actual puede ver, para que el
 * Sidebar muestre solo lo permitido. Refleja la config dinámica (~instantáneo).
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string })?.role
  if (!role) return NextResponse.json({ modulos: [] }, { status: 401 })
  const config = await getPermisosConfig()
  return NextResponse.json({ modulos: [...modulosPermitidos(role, config)] })
}
