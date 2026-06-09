import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, appendRow, updateRow, getNextId, deleteRow, ensureColumns, ensureSheet } from '@/lib/datastore'
import { todayISO } from '@/lib/dates'
import { normalizarRol } from '@/lib/roles'

const EXPECTED_COLS = ['id', 'nombre', 'email', 'password', 'rol', 'activo', 'fecha_creacion']

async function ensureUsuariosSheet() {
  await ensureSheet('usuarios')
  await ensureColumns('usuarios', EXPECTED_COLS)
}

/** Rol del usuario en sesión (admin / admin2 / operador). */
async function rolSesion(): Promise<string> {
  const s = await getServerSession(authOptions)
  return (s?.user as { role?: string })?.role ?? 'operador'
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
    const caller = await rolSesion()
    if (caller !== 'admin' && caller !== 'admin2') {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }
    const body = await req.json()
    if (!body.nombre || !body.email || !body.password) {
      return NextResponse.json({ error: 'nombre, email y password requeridos' }, { status: 400 })
    }
    await ensureUsuariosSheet()
    // Evitar duplicados por email
    const existentes = await getSheetData('usuarios')
    if (existentes.some(u => u.email?.trim().toLowerCase() === String(body.email).trim().toLowerCase())) {
      return NextResponse.json({ error: 'Ya existe un usuario con ese email' }, { status: 409 })
    }
    // Admin 2 solo puede crear operadores; Admin (1) puede crear cualquier rol.
    const rol = caller === 'admin2' ? 'operador' : normalizarRol(body.rol)
    const id = await getNextId('usuarios')
    const now = todayISO()
    const row = {
      id,
      nombre: String(body.nombre),
      email: String(body.email),
      password: String(body.password),
      rol,
      activo: 'TRUE',
      fecha_creacion: now,
    }
    await appendRow('usuarios', row)
    return NextResponse.json({ id, nombre: row.nombre, email: row.email, rol: row.rol, activo: row.activo }, { status: 201 })
  } catch (e) {
    console.error('[usuarios POST]', e)
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
    const caller = await rolSesion()
    if (caller === 'admin2' && normalizarRol(rows[idx].rol) !== 'operador') {
      return NextResponse.json({ error: 'Admin 2 solo puede eliminar operadores' }, { status: 403 })
    }
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
    const caller = await rolSesion()
    const target = rows[idx]
    if (caller === 'admin2') {
      if (normalizarRol(target.rol) !== 'operador') {
        return NextResponse.json({ error: 'Admin 2 solo puede gestionar operadores' }, { status: 403 })
      }
      if (updates.rol !== undefined && normalizarRol(updates.rol) !== 'operador') {
        return NextResponse.json({ error: 'Admin 2 no puede asignar roles de administrador' }, { status: 403 })
      }
    }
    if (updates.rol !== undefined) updates.rol = normalizarRol(updates.rol)
    const updated = { ...target, ...updates }
    await updateRow('usuarios', idx, updated)
    return NextResponse.json({ id, nombre: updated.nombre, email: updated.email, rol: updated.rol, activo: updated.activo })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}
