import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { listarAgenda } from '@/lib/agenda'
import { getSheetData, updateByIdIf } from '@/lib/datastore'

export const dynamic = 'force-dynamic'

/**
 * Agenda semanal del dashboard (retiros de cremación + retiros de eutanasia).
 * GET ?from=YYYY-MM-DD&to=YYYY-MM-DD → { items } para el rango visible.
 * La ven todos los usuarios logueados (igual que las notificaciones del bot).
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  try {
    const { searchParams } = new URL(req.url)
    const from = searchParams.get('from') || undefined
    const to = searchParams.get('to') || undefined
    const items = await listarAgenda(from, to)
    return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[agenda GET]', e)
    return NextResponse.json({ error: 'No se pudo cargar la agenda.' }, { status: 500 })
  }
}

/**
 * PATCH { id, hora } → ajusta SOLO la hora de un retiro directamente desde la
 * agenda, sin abrir la ficha (así no se corre el riesgo de "Registrar ficha" y
 * disparar el correo de bienvenida al tutor). Es un cambio de horario puntual:
 * NO registra, NO genera código, NO envía correos.
 *
 * `id` viene con el prefijo de la agenda: 'r<id>' = retiro (solicitudes_retiro).
 * Se actualiza la solicitud y, si tiene ficha vinculada, también su hora_retiro
 * (la ficha es la fuente de verdad de la agenda, ver lib/agenda). Las eutanasias
 * ('e<id>') se coordinan por el flujo del veterinario → no se editan aquí.
 */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  try {
    const body = await req.json().catch(() => ({}))
    const rawId = String(body.id ?? '').trim()
    const hora = String(body.hora ?? '').trim()
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(hora)) {
      return NextResponse.json({ error: 'Indica una hora válida (formato HH:MM).' }, { status: 400 })
    }
    if (!rawId.startsWith('r')) {
      return NextResponse.json({ error: 'La hora de una eutanasia se coordina con el veterinario, no desde la agenda.' }, { status: 400 })
    }
    const solicitudId = rawId.slice(1)
    const rows = await getSheetData('solicitudes_retiro')
    const sol = rows.find(r => String(r.id) === solicitudId)
    if (!sol) return NextResponse.json({ error: 'No encontramos ese retiro en la agenda.' }, { status: 404 })

    // Update parcial (solo hora_retiro): sin efectos secundarios de la ficha.
    const okSol = await updateByIdIf('solicitudes_retiro', solicitudId, {}, { hora_retiro: hora })
    if (sol.cliente_id) {
      await updateByIdIf('clientes', String(sol.cliente_id), {}, { hora_retiro: hora }).catch(() => {})
    }
    if (!okSol) return NextResponse.json({ error: 'No se pudo actualizar la hora.' }, { status: 500 })
    return NextResponse.json({ ok: true, hora })
  } catch (e) {
    console.error('[agenda PATCH]', e)
    return NextResponse.json({ error: 'No se pudo actualizar la hora.' }, { status: 500 })
  }
}
