import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { actualizarItem, eliminarItem, obtenerItem, type ItemCalendario } from '@/lib/marketing-calendario'

/**
 * /api/mailing/calendario/[id]  (admin)
 *  PATCH  { ...campos } → actualiza un ítem (incl. aprobar/descartar vía estado)
 *  DELETE → elimina el ítem
 */

const EDITABLES: (keyof ItemCalendario)[] = [
  'fecha', 'hora', 'canal', 'estado', 'activa', 'favorita', 'objetivo', 'audiencia', 'idea', 'titulo', 'cuerpo',
  'imagen_id', 'imagen_url', 'imagenes_json', 'notas',
]

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!esAdminTotal((session?.user as { role?: string })?.role)) {
    return { denied: NextResponse.json({ error: 'Solo admin' }, { status: 403 }), session: null }
  }
  return { denied: null, session }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { denied, session } = await requireAdmin()
  if (denied) return denied
  const { id } = await params
  try {
    const body = (await req.json()) as Partial<Record<keyof ItemCalendario, string>>
    const cambios: Partial<Record<keyof ItemCalendario, string>> = {}
    for (const k of EDITABLES) {
      if (body[k] !== undefined) cambios[k] = String(body[k])
    }
    // Al aprobar, registrar quién aprobó.
    if (body.estado === 'aprobada') {
      cambios.aprobado_por = session?.user?.name || session?.user?.email || ''
    }
    if (Object.keys(cambios).length === 0) {
      return NextResponse.json({ error: 'Nada que actualizar.' }, { status: 400 })
    }
    const item = await actualizarItem(id, cambios)
    return NextResponse.json({ item })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[mailing/calendario PATCH]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { denied } = await requireAdmin()
  if (denied) return denied
  const { id } = await params
  try {
    const existe = await obtenerItem(id)
    if (!existe) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    await eliminarItem(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[mailing/calendario DELETE]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
