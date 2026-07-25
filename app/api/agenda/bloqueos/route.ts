import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { listarBloqueos, SHEET_BLOQUEOS } from '@/lib/agenda'
import { appendRow, deleteById, getNextId, getSheetData, updateByIdIf } from '@/lib/datastore'
import { formatDateForSheet } from '@/lib/dates'

export const dynamic = 'force-dynamic'

const RE_HORA = /^([01]?\d|2[0-3]):[0-5]\d$/

/**
 * Bloqueos manuales de la agenda ("Bloquear agenda" en el dashboard): rangos
 * fecha/hora en los que el bot NO puede agendar retiros ni eutanasias.
 *
 *  GET    ?from&to  → { bloqueos } (los que se cruzan con el rango; sin rango, todos)
 *  POST   { fecha_inicio, hora_inicio, fecha_fin, hora_fin, motivo? } → crea
 *  PATCH  { id, ...los mismos campos } → edita un bloqueo existente
 *  DELETE ?id=      → elimina el bloqueo (la agenda vuelve a estar libre)
 *
 * Lo puede usar cualquier usuario logueado, igual que el ajuste de hora del
 * retiro desde la agenda (es una acción operativa del día a día).
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  try {
    const { searchParams } = new URL(req.url)
    const bloqueos = await listarBloqueos(searchParams.get('from') || undefined, searchParams.get('to') || undefined)
    return NextResponse.json({ bloqueos }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[agenda/bloqueos GET]', e)
    return NextResponse.json({ error: 'No se pudieron cargar los bloqueos.' }, { status: 500 })
  }
}

/** Valida y normaliza el rango del bloqueo (compartido por POST y PATCH). */
function normalizarRango(body: Record<string, unknown>):
  { error: string } | { fecha_inicio: string; hora_inicio: string; fecha_fin: string; hora_fin: string; motivo: string } {
  const fechaInicio = formatDateForSheet(String(body.fecha_inicio ?? '').trim())
  const fechaFin = formatDateForSheet(String(body.fecha_fin ?? '').trim()) || fechaInicio
  const horaInicio = String(body.hora_inicio ?? '').trim() || '00:00'
  const horaFin = String(body.hora_fin ?? '').trim() || '23:59'

  if (!fechaInicio) return { error: 'Indica la fecha de inicio.' }
  if (!RE_HORA.test(horaInicio) || !RE_HORA.test(horaFin)) return { error: 'Indica horas válidas (formato HH:MM).' }
  if (fechaFin < fechaInicio) return { error: 'La fecha de término no puede ser anterior a la de inicio.' }
  if (fechaFin === fechaInicio && horaFin <= horaInicio) return { error: 'La hora de término debe ser posterior a la de inicio.' }

  return {
    fecha_inicio: fechaInicio,
    hora_inicio: horaInicio,
    fecha_fin: fechaFin,
    hora_fin: horaFin,
    motivo: String(body.motivo ?? '').trim().slice(0, 200),
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  try {
    const rango = normalizarRango(await req.json().catch(() => ({})))
    if ('error' in rango) return NextResponse.json({ error: rango.error }, { status: 400 })

    const id = await getNextId(SHEET_BLOQUEOS)
    await appendRow(SHEET_BLOQUEOS, {
      id,
      ...rango,
      creado_por: (session.user as { email?: string })?.email || '',
      fecha_creacion: new Date().toISOString(),
      activo: 'TRUE',
    })
    return NextResponse.json({ ok: true, id })
  } catch (e) {
    console.error('[agenda/bloqueos POST]', e)
    return NextResponse.json({ error: 'No se pudo bloquear la agenda.' }, { status: 500 })
  }
}

/** Edita el rango (y el motivo) de un bloqueo ya creado. */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  try {
    const body = await req.json().catch(() => ({}))
    const id = String(body.id ?? '').trim()
    if (!id) return NextResponse.json({ error: 'Falta el id del bloqueo.' }, { status: 400 })

    const rango = normalizarRango(body)
    if ('error' in rango) return NextResponse.json({ error: rango.error }, { status: 400 })

    const rows = await getSheetData(SHEET_BLOQUEOS).catch(() => [] as Record<string, string>[])
    if (!rows.some(r => String(r.id) === id)) {
      return NextResponse.json({ error: 'Ese bloqueo ya no existe.' }, { status: 404 })
    }
    // Update PARCIAL (updateByIdIf sin condiciones): updateById escribiría la fila
    // completa y borraría creado_por / fecha_creacion / activo.
    const ok = await updateByIdIf(SHEET_BLOQUEOS, id, {}, rango)
    if (!ok) return NextResponse.json({ error: 'No se pudo actualizar el bloqueo.' }, { status: 500 })
    return NextResponse.json({ ok: true, id })
  } catch (e) {
    console.error('[agenda/bloqueos PATCH]', e)
    return NextResponse.json({ error: 'No se pudo actualizar el bloqueo.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  try {
    const id = new URL(req.url).searchParams.get('id')?.trim()
    if (!id) return NextResponse.json({ error: 'Falta el id del bloqueo.' }, { status: 400 })
    const rows = await getSheetData(SHEET_BLOQUEOS).catch(() => [] as Record<string, string>[])
    if (!rows.some(r => String(r.id) === id)) {
      return NextResponse.json({ error: 'Ese bloqueo ya no existe.' }, { status: 404 })
    }
    await deleteById(SHEET_BLOQUEOS, id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[agenda/bloqueos DELETE]', e)
    return NextResponse.json({ error: 'No se pudo quitar el bloqueo.' }, { status: 500 })
  }
}
