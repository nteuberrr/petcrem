import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, appendRow, updateRow, getNextId, deleteRow, ensureColumn, ensureSheet } from '@/lib/google-sheets'

const EXPECTED_COLS = ['id', 'nombre', 'email', 'password', 'rol', 'activo', 'fecha_creacion']

async function ensureUsuariosSheet() {
  await ensureSheet('usuarios')
  for (const col of EXPECTED_COLS) await ensureColumn('usuarios', col)
}

export async function GET() {
  try {
    await ensureUsuariosSheet()
    const rows = await getSheetData('usuarios')
    return NextResponse.json(rows.map(u => ({
      id: u.id,
      nombre: u.nombre,
      email: u.email,
      rol: u.rol,
      activo: u.activo,
      fecha_creacion: u.fecha_creacion,
    })))
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (!body.nombre || !body.email || !body.password) {
      return NextResponse.json({ error: 'nombre, email y password requeridos' }, { status: 400 })
    }
    await ensureUsuariosSheet()
    const id = await getNextId('usuarios')
    const now = new Date().toISOString().split('T')[0]
    const row = {
      id,
      nombre: body.nombre,
      email: body.email,
      password: body.password,
      rol: body.rol ?? 'operador',
      activo: 'TRUE',
      fecha_creacion: now,
    }
    await appendRow('usuarios', row)
    return NextResponse.json({ id, nombre: row.nombre, email: row.email, rol: row.rol, activo: row.activo }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    const rows = await getSheetData('usuarios')
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    await deleteRow('usuarios', idx)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { id, ...updates } = body
    const rows = await getSheetData('usuarios')
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    const updated = { ...rows[idx], ...updates }
    await updateRow('usuarios', idx, updated)
    return NextResponse.json({ id, nombre: updated.nombre, email: updated.email, rol: updated.rol, activo: updated.activo })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}
