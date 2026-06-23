import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { getSheetData, appendRow, updateById, deleteById, getNextId } from '@/lib/datastore'
import { todayISO } from '@/lib/dates'

export const dynamic = 'force-dynamic'

const SHEET = 'eerr_partidas'
const TIPOS = ['ingreso', 'costo', 'gasto', 'impuesto']

/** Estado de Resultados es solo del administrador principal (defensa en profundidad). */
async function noAutorizado(): Promise<boolean> {
  const s = await getServerSession(authOptions)
  return !esAdminTotal((s?.user as { role?: string })?.role)
}

function esDuplicado(e: unknown): boolean {
  const m = String(e).toLowerCase()
  return m.includes('duplicate') || m.includes('unique')
}

export async function GET() {
  if (await noAutorizado()) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  try {
    const [rows, subgrupos] = await Promise.all([getSheetData(SHEET), getSheetData('eerr_subgrupos')])
    const sgOrden = new Map(subgrupos.map(s => [s.id, parseInt(s.orden) || 0]))
    const SUELTA = 99999
    // Mismo orden que Parámetros: por subgrupo (su orden) y luego por orden de la
    // partida. Así los desplegables de asignación quedan en el mismo orden.
    rows.sort((a, b) =>
      ((sgOrden.get(a.subgrupo_id || '') ?? SUELTA) - (sgOrden.get(b.subgrupo_id || '') ?? SUELTA))
      || ((parseInt(a.orden) || 0) - (parseInt(b.orden) || 0)))
    return NextResponse.json(rows)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (await noAutorizado()) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  try {
    const b = await req.json()
    const tipo = String(b.tipo || '')
    const nombre = String(b.nombre || '').trim()
    if (!TIPOS.includes(tipo)) return NextResponse.json({ error: 'Tipo inválido (ingreso/costo/gasto/impuesto)' }, { status: 400 })
    if (!nombre) return NextResponse.json({ error: 'El nombre es requerido' }, { status: 400 })
    const id = await getNextId(SHEET)
    const row = {
      id,
      tipo,
      nombre,
      clave: String(b.clave || ''),
      orden: String(b.orden ?? ''),
      subgrupo_id: String(b.subgrupo_id || ''),
      activo: b.activo === false || b.activo === 'FALSE' ? 'FALSE' : 'TRUE',
      fecha_creacion: todayISO(),
    }
    await appendRow(SHEET, row)
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    if (esDuplicado(e)) return NextResponse.json({ error: 'Ya existe una partida con ese nombre en ese tipo.' }, { status: 409 })
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  if (await noAutorizado()) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  try {
    const b = await req.json()
    const { id, ...updates } = b
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    if ('tipo' in updates && !TIPOS.includes(String(updates.tipo))) {
      return NextResponse.json({ error: 'Tipo inválido' }, { status: 400 })
    }
    if ('activo' in updates) updates.activo = updates.activo === false || updates.activo === 'FALSE' ? 'FALSE' : 'TRUE'
    if ('nombre' in updates) updates.nombre = String(updates.nombre || '').trim()
    const rows = await getSheetData(SHEET)
    const row = rows.find(r => String(r.id) === String(id))
    if (!row) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    const updated = { ...row, ...updates }
    await updateById(SHEET, String(id), updated)
    return NextResponse.json(updated)
  } catch (e) {
    if (esDuplicado(e)) return NextResponse.json({ error: 'Ya existe una partida con ese nombre en ese tipo.' }, { status: 409 })
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
