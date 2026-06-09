import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, updateRow, deleteRow, ensureSheet, ensureColumns } from '@/lib/datastore'
import { esAdmin } from '@/lib/roles'

const SHEET = 'mailing_veterinarios'
const COLS = ['id', 'nombre', 'email', 'veterinaria', 'comuna', 'telefono', 'categoria', 'suscrito', 'notas', 'fecha_creacion']

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!esAdmin((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  return null
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { id } = await params
    const body = await req.json() as Record<string, string | boolean>
    await ensureSheet(SHEET)
    await ensureColumns(SHEET, COLS)
    const rows = await getSheetData(SHEET)
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    const existing = rows[idx]

    // Si cambia el email, validar duplicados
    const nuevoEmail = body.email != null ? String(body.email).trim().toLowerCase() : existing.email
    if (nuevoEmail !== existing.email && rows.some(r => r.id !== id && (r.email || '').trim().toLowerCase() === nuevoEmail)) {
      return NextResponse.json({ error: 'Ya existe un veterinario con ese email' }, { status: 409 })
    }

    const updated = {
      ...existing,
      nombre: body.nombre != null ? String(body.nombre).trim() : existing.nombre,
      email: nuevoEmail,
      veterinaria: body.veterinaria != null ? String(body.veterinaria).trim() : existing.veterinaria,
      comuna: body.comuna != null ? String(body.comuna).trim() : existing.comuna,
      telefono: body.telefono != null ? String(body.telefono).trim() : existing.telefono,
      categoria: body.categoria != null ? String(body.categoria).trim() : existing.categoria,
      suscrito: body.suscrito != null ? (body.suscrito === false || body.suscrito === 'FALSE' ? 'FALSE' : 'TRUE') : existing.suscrito,
      notas: body.notas != null ? String(body.notas).trim() : existing.notas,
    }
    await updateRow(SHEET, idx, updated)
    return NextResponse.json({ ok: true, data: updated })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { id } = await params
    const rows = await getSheetData(SHEET)
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    await deleteRow(SHEET, idx)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
