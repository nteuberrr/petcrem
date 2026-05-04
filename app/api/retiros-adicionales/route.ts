import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, appendRow, updateRow, deleteRow, getNextId, ensureColumns, ensureSheet } from '@/lib/google-sheets'
import { todayISO, formatDateForSheet, formatHora } from '@/lib/dates'

export const dynamic = 'force-dynamic'

const HOJA = 'retiros_adicionales'
const COLS = ['id', 'usuario_id', 'usuario_nombre', 'fecha', 'hora', 'cliente_nombre', 'comentario', 'pago_id', 'fecha_creacion']

async function ensure() {
  await ensureSheet(HOJA)
  await ensureColumns(HOJA, COLS)
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    await ensure()
    const { searchParams } = new URL(req.url)
    const desde = searchParams.get('desde')
    const hasta = searchParams.get('hasta')
    const usuarioIdFilter = searchParams.get('usuario_id')

    const rows = await getSheetData(HOJA)
    let filtered = rows

    // Operador solo ve sus propios registros
    const role = (session.user as { role?: string })?.role
    if (role !== 'admin') {
      const myId = (session.user as { id?: string })?.id ?? ''
      if (!myId) return NextResponse.json([])
      filtered = filtered.filter(r => r.usuario_id === myId)
    } else if (usuarioIdFilter) {
      filtered = filtered.filter(r => r.usuario_id === usuarioIdFilter)
    }

    if (desde) filtered = filtered.filter(r => (formatDateForSheet(r.fecha) || r.fecha) >= desde)
    if (hasta) filtered = filtered.filter(r => (formatDateForSheet(r.fecha) || r.fecha) <= hasta)

    // Ordenar por fecha desc, luego por hora desc
    filtered.sort((a, b) => {
      const fa = formatDateForSheet(a.fecha) || a.fecha
      const fb = formatDateForSheet(b.fecha) || b.fecha
      const cmp = fb.localeCompare(fa)
      if (cmp !== 0) return cmp
      return formatHora(b.hora).localeCompare(formatHora(a.hora))
    })

    const normalized = filtered.map(r => ({
      ...r,
      fecha: formatDateForSheet(r.fecha) || r.fecha,
      hora: formatHora(r.hora),
    }))

    return NextResponse.json(normalized)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    const body = await req.json()
    const { fecha, hora, cliente_nombre, comentario } = body
    if (!fecha || !hora || !cliente_nombre?.trim()) {
      return NextResponse.json({ error: 'fecha, hora y cliente_nombre son requeridos' }, { status: 400 })
    }
    await ensure()
    const usuarioId = (session.user as { id?: string })?.id ?? '0'
    const usuarioNombre = session.user?.name ?? session.user?.email ?? ''
    const id = await getNextId(HOJA)
    const row = {
      id,
      usuario_id: usuarioId,
      usuario_nombre: usuarioNombre,
      fecha: formatDateForSheet(String(fecha)) || String(fecha),
      hora: formatHora(String(hora)),
      cliente_nombre: String(cliente_nombre).trim(),
      comentario: comentario ?? '',
      pago_id: '',
      fecha_creacion: todayISO(),
    }
    await appendRow(HOJA, row)
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    const body = await req.json()
    const { id, ...updates } = body
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    await ensure()
    const rows = await getSheetData(HOJA)
    const idx = rows.findIndex(r => r.id === String(id))
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    const role = (session.user as { role?: string })?.role
    const isAdmin = role === 'admin'
    const myId = (session.user as { id?: string })?.id ?? '0'
    if (!isAdmin && rows[idx].usuario_id !== myId) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    // pago_id no se puede modificar desde acá (solo vía /api/pagos-retiros)
    const safeUpdates = { ...updates }
    delete safeUpdates.pago_id
    delete safeUpdates.usuario_id
    delete safeUpdates.usuario_nombre
    const updated: Record<string, unknown> = { ...rows[idx], ...safeUpdates }

    // Normalizar a formatos canónicos para evitar la corrupción por locale es-CL
    if (updated.fecha) updated.fecha = formatDateForSheet(String(updated.fecha)) || String(updated.fecha)
    if (updated.hora) updated.hora = formatHora(String(updated.hora))
    if (updated.fecha_creacion) updated.fecha_creacion = formatDateForSheet(String(updated.fecha_creacion)) || String(updated.fecha_creacion)
    if (typeof updated.cliente_nombre === 'string') updated.cliente_nombre = updated.cliente_nombre.trim()

    await updateRow(HOJA, idx, updated)
    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    const rows = await getSheetData(HOJA)
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    const role = (session.user as { role?: string })?.role
    const myId = (session.user as { id?: string })?.id ?? '0'
    if (role !== 'admin' && rows[idx].usuario_id !== myId) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }
    if (rows[idx].pago_id) {
      return NextResponse.json({ error: 'Este retiro ya está incluido en un pago. Anulá el pago primero.' }, { status: 409 })
    }
    await deleteRow(HOJA, idx)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
