import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { listarCalendario, crearItem, type NuevoItem } from '@/lib/marketing-calendario'

/**
 * /api/mailing/calendario  (admin — gateada a admin principal por proxy)
 *  GET  ?desde&hasta&canal&estado  → lista el calendario de campañas
 *  POST  { fecha, canal, idea, ... } → crea un ítem manual (estado propuesta por defecto)
 */

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!esAdminTotal((session?.user as { role?: string })?.role)) {
    return { denied: NextResponse.json({ error: 'Solo admin' }, { status: 403 }), session: null }
  }
  return { denied: null, session }
}

export async function GET(req: NextRequest) {
  const { denied } = await requireAdmin()
  if (denied) return denied
  try {
    const sp = req.nextUrl.searchParams
    const items = await listarCalendario({
      desde: sp.get('desde') || undefined,
      hasta: sp.get('hasta') || undefined,
      canal: sp.get('canal') || undefined,
      estado: sp.get('estado') || undefined,
    })
    return NextResponse.json({ items })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[mailing/calendario GET]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const { denied, session } = await requireAdmin()
  if (denied) return denied
  try {
    const body = (await req.json()) as Partial<NuevoItem>
    if (!body.fecha || !body.canal || !body.idea) {
      return NextResponse.json({ error: 'Faltan campos: fecha, canal e idea son obligatorios.' }, { status: 400 })
    }
    const item = await crearItem({
      fecha: body.fecha,
      canal: body.canal,
      objetivo: body.objetivo,
      audiencia: body.audiencia,
      idea: body.idea,
      titulo: body.titulo,
      cuerpo: body.cuerpo,
      estado: body.estado || 'propuesta',
      generado_por: 'humano',
      notas: body.notas,
      creadoPor: session?.user?.name || session?.user?.email || '',
    })
    return NextResponse.json({ item })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[mailing/calendario POST]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
