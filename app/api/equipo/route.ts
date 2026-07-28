import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdmin } from '@/lib/roles'
import { getSheetData, ensureSheet, ensureColumns } from '@/lib/datastore'

/**
 * GET /api/equipo — listado BÁSICO del equipo (id, nombre, email, rol) de los
 * usuarios ACTIVOS. Sin contraseñas ni datos de contacto.
 *
 * Existe porque `/api/usuarios` es Configuración Avanzada → SOLO el dueño, y su
 * prefijo completo está bloqueado por el proxy (no sirve colgarle un sub-path).
 * Pantallas como Rendiciones necesitan la lista para elegir a quién corresponde
 * un gasto: hasta ahora admin2 recibía 403 y el selector le quedaba con un solo
 * nombre, el "Administrador" que la página agrega a mano (reporte del dueño
 * 2026-07-28). Acá el gate es esAdmin (admin + admin2).
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!esAdmin((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }
  try {
    await ensureSheet('usuarios')
    await ensureColumns('usuarios', ['id', 'nombre', 'email', 'rol', 'activo'])
    const rows = await getSheetData('usuarios')
    return NextResponse.json(
      rows
        .filter(u => (u.activo ?? 'TRUE') !== 'FALSE')
        .map(u => ({ id: u.id, nombre: u.nombre, email: u.email, rol: u.rol })),
    )
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
