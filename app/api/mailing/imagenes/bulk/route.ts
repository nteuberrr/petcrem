import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdmin } from '@/lib/roles'
import { actualizarImagen, eliminarImagen } from '@/lib/mailing-images'

/**
 * POST /api/mailing/imagenes/bulk  (admin)
 * Acciones masivas sobre una selección del banco.
 * Body: { ids: string[], action: 'delete' | 'set_grupo' | 'set_whatsapp' | 'set_favorita', value?: string|boolean }
 * Devuelve { afectadas, errores }.
 *
 * Secuencial (no Promise.all): mantiene el comportamiento estable del datastore y
 * evita topar límites de concurrencia; el banco es chico.
 */

const ACCIONES = new Set(['delete', 'set_grupo', 'set_whatsapp', 'set_favorita'])

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!esAdmin((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  try {
    const body = await req.json() as { ids?: string[]; action?: string; value?: string | boolean }
    const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).filter(Boolean)
    const action = String(body.action || '')
    if (ids.length === 0) return NextResponse.json({ error: 'No hay imágenes seleccionadas.' }, { status: 400 })
    if (!ACCIONES.has(action)) return NextResponse.json({ error: 'Acción inválida.' }, { status: 400 })

    let afectadas = 0
    const errores: string[] = []
    for (const id of ids) {
      try {
        if (action === 'delete') {
          await eliminarImagen(id)
        } else if (action === 'set_grupo') {
          await actualizarImagen(id, { grupo: String(body.value || '') })
        } else if (action === 'set_whatsapp') {
          await actualizarImagen(id, { whatsapp: body.value === true || body.value === 'TRUE' })
        } else if (action === 'set_favorita') {
          await actualizarImagen(id, { favorita: body.value === true || body.value === 'TRUE' })
        }
        afectadas++
      } catch (e) {
        errores.push(`${id}: ${e instanceof Error ? e.message : 'error'}`)
      }
    }
    return NextResponse.json({ afectadas, errores })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
