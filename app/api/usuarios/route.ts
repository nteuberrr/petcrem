import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, appendRow, updateRow, getNextId, deleteRow, ensureColumns, ensureSheet } from '@/lib/datastore'
import { todayISO } from '@/lib/dates'
import { normalizarRol, esAdmin } from '@/lib/roles'

const EXPECTED_COLS = ['id', 'nombre', 'email', 'password', 'rol', 'activo', 'fecha_creacion', 'telefono', 'avisos_whatsapp']

/** Celular a 9 dígitos (se guarda así; al enviar se antepone 56). '' si no da. */
function normalizarTelefono(v: unknown): string {
  const t = String(v ?? '').replace(/\D/g, '').slice(-9)
  return t.length === 9 ? t : ''
}

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
    // Gestión de usuarios = Configuración Avanzada → solo el admin principal.
    if ((await rolSesion()) !== 'admin') {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }
    await ensureUsuariosSheet()
    const rows = await getSheetData('usuarios')
    return NextResponse.json(rows.map(u => ({
      id: u.id,
      nombre: u.nombre,
      email: u.email,
      rol: u.rol,
      activo: u.activo,
      fecha_creacion: u.fecha_creacion,
      telefono: u.telefono || '',
      avisos_whatsapp: u.avisos_whatsapp || 'FALSE',
    })))
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await rolSesion()
    if (caller !== 'admin') {
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
    const rol = normalizarRol(body.rol)
    const id = await getNextId('usuarios')
    const now = todayISO()
    const telefono = normalizarTelefono(body.telefono)
    const row = {
      id,
      nombre: String(body.nombre),
      email: String(body.email),
      password: bcrypt.hashSync(String(body.password), 10),
      rol,
      activo: 'TRUE',
      fecha_creacion: now,
      telefono,
      // Avisos solo con teléfono Y rol admin/admin2 (lo del bot/inbox no es de operadores).
      avisos_whatsapp: telefono && esAdmin(rol) && body.avisos_whatsapp === 'TRUE' ? 'TRUE' : 'FALSE',
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
    // Gestión de usuarios = Configuración Avanzada → solo el admin principal.
    if (caller !== 'admin') {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
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
    // Gestión de usuarios = Configuración Avanzada → solo el admin principal.
    if (caller !== 'admin') {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }
    const target = rows[idx]
    if (updates.rol !== undefined) updates.rol = normalizarRol(updates.rol)
    if (updates.telefono !== undefined) updates.telefono = normalizarTelefono(updates.telefono)
    // Password vacío/omitido = no cambiar; si viene, se guarda hasheado
    if (updates.password) {
      updates.password = bcrypt.hashSync(String(updates.password), 10)
    } else {
      delete updates.password
    }
    const updated = { ...target, ...updates }
    // Avisos por WhatsApp solo con teléfono Y rol admin/admin2 (coherencia servidor, no solo UI).
    if (!updated.telefono || !esAdmin(updated.rol)) updated.avisos_whatsapp = 'FALSE'
    await updateRow('usuarios', idx, updated)
    return NextResponse.json({ id, nombre: updated.nombre, email: updated.email, rol: updated.rol, activo: updated.activo })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}
