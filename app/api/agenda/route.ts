import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { listarAgenda, listarBloqueos, conflictosEnAgenda, describirConflictos } from '@/lib/agenda'
import { getSheetData, updateByIdIf } from '@/lib/datastore'
import { sincronizarEutanasiaDeFicha } from '@/lib/eutanasia-sync'
import { avisarCambioDeRetiro } from '@/lib/aviso-cambio-retiro'

export const dynamic = 'force-dynamic'

/**
 * Agenda semanal del dashboard (retiros de cremación + retiros de eutanasia).
 * GET ?from=YYYY-MM-DD&to=YYYY-MM-DD → { items, bloqueos } para el rango visible
 * (los bloqueos manuales se crean/eliminan en /api/agenda/bloqueos).
 * La ven todos los usuarios logueados (igual que las notificaciones del bot).
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  try {
    const { searchParams } = new URL(req.url)
    const from = searchParams.get('from') || undefined
    const to = searchParams.get('to') || undefined
    const [items, bloqueos] = await Promise.all([
      listarAgenda(from, to, { conValor: true }),
      listarBloqueos(from, to),
    ])
    return NextResponse.json({ items, bloqueos }, { headers: { 'Cache-Control': 'no-store' } })
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

    // Fecha de referencia: la de la ficha si la tiene (manda sobre la solicitud).
    const ficha = sol.cliente_id
      ? (await getSheetData('clientes')).find(c => String(c.id) === String(sol.cliente_id))
      : undefined
    const fechaRef = String(ficha?.fecha_retiro || sol.fecha_retiro || '')
    const horaAntes = String(ficha?.hora_retiro || sol.hora_retiro || '')

    // Mover la hora acá no validaba nada: se podía dejar un retiro pegado a otro
    // y el chofer se enteraba en la ruta. Se avisa y se deja decidir (`forzar`).
    if (!body.forzar) {
      const choques = await conflictosEnAgenda(fechaRef, hora, rawId)
      if (choques.length > 0) {
        return NextResponse.json({
          error: `Esa hora choca con ${describirConflictos(choques)} (dejamos 30 min antes y 45 después).`,
          conflicto: true,
        }, { status: 409 })
      }
    }

    // Update parcial (solo hora_retiro): sin efectos secundarios de la ficha.
    const okSol = await updateByIdIf('solicitudes_retiro', solicitudId, {}, { hora_retiro: hora })
    if (sol.cliente_id) {
      await updateByIdIf('clientes', String(sol.cliente_id), {}, { hora_retiro: hora }).catch(() => {})
      // Si el retiro es de una eutanasia, su cotización tiene que seguir la hora
      // (la agenda de eutanasias se lee desde ahí, no desde la ficha).
      await sincronizarEutanasiaDeFicha(String(sol.cliente_id), { hora_retiro: hora }).catch(() => '')
    }
    if (!okSol) return NextResponse.json({ error: 'No se pudo actualizar la hora.' }, { status: 500 })

    // Aviso al tutor / veterinario, solo si quien mueve la hora lo pide.
    let aviso: { enviado: boolean; via?: string; motivo?: string } | undefined
    if (body.avisar) {
      aviso = await avisarCambioDeRetiro(
        { ...(ficha ?? {}), nombre_mascota: String(ficha?.nombre_mascota || sol.nombre_mascota || ''),
          nombre_tutor: String(ficha?.nombre_tutor || sol.cliente_nombre || ''),
          telefono: String(ficha?.telefono || sol.cliente_wa_id || ''),
          veterinaria_id: String(ficha?.veterinaria_id || sol.veterinaria_id || ''),
          fecha_retiro: fechaRef, hora_retiro: hora },
        { fecha: fechaRef, hora: horaAntes },
      )
    }
    return NextResponse.json({ ok: true, hora, ...(aviso ? { aviso } : {}) })
  } catch (e) {
    console.error('[agenda PATCH]', e)
    return NextResponse.json({ error: 'No se pudo actualizar la hora.' }, { status: 500 })
  }
}
