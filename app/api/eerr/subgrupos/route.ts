import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { getSheetData, appendRow, updateById, deleteById, getNextId } from '@/lib/datastore'
import { todayISO } from '@/lib/dates'

export const dynamic = 'force-dynamic'

const SHEET = 'eerr_subgrupos'
const TIPOS = ['ingreso', 'costo', 'gasto', 'impuesto']

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
    return NextResponse.json(await getSheetData(SHEET))
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
    if (!TIPOS.includes(tipo)) return NextResponse.json({ error: 'Tipo inválido' }, { status: 400 })
    if (!nombre) return NextResponse.json({ error: 'El nombre es requerido' }, { status: 400 })
    const existentes = await getSheetData(SHEET)
    const orden = b.orden !== undefined ? String(b.orden) : String(existentes.filter(s => s.tipo === tipo).length + 1)
    const id = await getNextId(SHEET)
    const row = { id, tipo, nombre, orden, fecha_creacion: todayISO() }
    await appendRow(SHEET, row)
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    if (esDuplicado(e)) return NextResponse.json({ error: 'Ya existe un subgrupo con ese nombre en ese tipo.' }, { status: 409 })
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  if (await noAutorizado()) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  try {
    const b = await req.json()
    const { id, ...updates } = b
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    if ('nombre' in updates) updates.nombre = String(updates.nombre || '').trim()
    const rows = await getSheetData(SHEET)
    const row = rows.find(r => String(r.id) === String(id))
    if (!row) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    const updated = { ...row, ...updates }
    await updateById(SHEET, String(id), updated)
    return NextResponse.json(updated)
  } catch (e) {
    if (esDuplicado(e)) return NextResponse.json({ error: 'Ya existe un subgrupo con ese nombre en ese tipo.' }, { status: 409 })
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

/** Elimina un subgrupo. Las partidas que tenía quedan SUELTAS (subgrupo_id=''), no
 *  se borran. */
export async function DELETE(req: NextRequest) {
  if (await noAutorizado()) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    const partidas = await getSheetData('eerr_partidas')
    for (const p of partidas.filter(p => p.subgrupo_id === id)) {
      await updateById('eerr_partidas', p.id, { ...p, subgrupo_id: '' })
    }
    await deleteById(SHEET, id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
