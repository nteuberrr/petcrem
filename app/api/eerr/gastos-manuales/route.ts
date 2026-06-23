import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { getSheetData, appendRow, updateById, deleteById, getNextId } from '@/lib/datastore'
import { todayISO } from '@/lib/dates'

export const dynamic = 'force-dynamic'

const SHEET = 'eerr_gastos_manuales'
const TIPOS = ['costo', 'gasto', 'impuesto']

async function noAutorizado(): Promise<boolean> {
  const s = await getServerSession(authOptions)
  return !esAdminTotal((s?.user as { role?: string })?.role)
}

export async function GET(req: NextRequest) {
  if (await noAutorizado()) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  try {
    const { searchParams } = new URL(req.url)
    const desde = (searchParams.get('desde') || '').trim()
    const hasta = (searchParams.get('hasta') || '').trim()
    let rows = await getSheetData(SHEET)
    rows = rows.filter(r => {
      const f = r.fecha || ''
      if (desde && f < desde) return false
      if (hasta && f > hasta) return false
      return true
    })
    rows.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
    return NextResponse.json(rows)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (await noAutorizado()) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  try {
    const b = await req.json()
    const tipo = String(b.tipo_asignacion || '')
    const partida_id = String(b.partida_id || '')
    const detalle = String(b.detalle || '').trim()
    const monto = String(b.monto ?? '').trim()
    if (!TIPOS.includes(tipo)) return NextResponse.json({ error: 'Elegí costo/gasto/impuesto' }, { status: 400 })
    if (!partida_id) return NextResponse.json({ error: 'Elegí una partida' }, { status: 400 })
    if (!detalle) return NextResponse.json({ error: 'El detalle es requerido' }, { status: 400 })
    if (!monto || isNaN(Number(monto))) return NextResponse.json({ error: 'Monto inválido' }, { status: 400 })
    const id = await getNextId(SHEET)
    const row = {
      id, tipo_asignacion: tipo, partida_id, detalle,
      monto: String(Math.round(Number(monto))),
      fecha: String(b.fecha || todayISO()),
      fecha_creacion: todayISO(),
    }
    await appendRow(SHEET, row)
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  if (await noAutorizado()) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  try {
    const b = await req.json()
    const { id, ids, ...updates } = b

    // Bulk: asignar la misma partida/tipo a varios gastos manuales a la vez.
    if (Array.isArray(ids) && ids.length > 0) {
      const tipo = String(updates.tipo_asignacion || '')
      const partida = String(updates.partida_id || '')
      if (tipo && !TIPOS.includes(tipo)) return NextResponse.json({ error: 'Tipo inválido' }, { status: 400 })
      const rows = await getSheetData(SHEET)
      const byId = new Map(rows.map(r => [String(r.id), r]))
      let asignadas = 0
      for (const rid of ids) {
        const row = byId.get(String(rid))
        if (!row) continue
        await updateById(SHEET, row.id, { ...row, tipo_asignacion: tipo, partida_id: partida })
        asignadas++
      }
      return NextResponse.json({ ok: true, asignadas })
    }

    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    if ('tipo_asignacion' in updates && !TIPOS.includes(String(updates.tipo_asignacion))) {
      return NextResponse.json({ error: 'Tipo inválido' }, { status: 400 })
    }
    if ('monto' in updates) updates.monto = String(Math.round(Number(updates.monto) || 0))
    const rows = await getSheetData(SHEET)
    const row = rows.find(r => String(r.id) === String(id))
    if (!row) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    const updated = { ...row, ...updates }
    await updateById(SHEET, String(id), updated)
    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  if (await noAutorizado()) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    await deleteById(SHEET, id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
