import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, appendRow, getNextId, ensureSheet, ensureColumns } from '@/lib/datastore'
import { todayISO } from '@/lib/dates'
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

export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  await ensureSheet(SHEET)
  await ensureColumns(SHEET, COLS)
  const rows = await getSheetData(SHEET)
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const body = await req.json() as Record<string, string | boolean>
    if (!body.email || !String(body.email).trim()) {
      return NextResponse.json({ error: 'email es requerido' }, { status: 400 })
    }
    if (!body.nombre || !String(body.nombre).trim()) {
      return NextResponse.json({ error: 'nombre es requerido' }, { status: 400 })
    }
    await ensureSheet(SHEET)
    await ensureColumns(SHEET, COLS)

    // Anti-duplicado por email
    const rows = await getSheetData(SHEET)
    const emailLower = String(body.email).trim().toLowerCase()
    if (rows.some(r => (r.email || '').trim().toLowerCase() === emailLower)) {
      return NextResponse.json({ error: `Ya existe un veterinario con ese email` }, { status: 409 })
    }

    const id = await getNextId(SHEET)
    const data = {
      id,
      nombre: String(body.nombre).trim(),
      email: emailLower,
      veterinaria: String(body.veterinaria ?? '').trim(),
      comuna: String(body.comuna ?? '').trim(),
      telefono: String(body.telefono ?? '').trim(),
      categoria: String(body.categoria ?? 'prospecto').trim(),
      suscrito: body.suscrito === false || body.suscrito === 'FALSE' ? 'FALSE' : 'TRUE',
      notas: String(body.notas ?? '').trim(),
      fecha_creacion: todayISO(),
    }
    await appendRow(SHEET, data)
    return NextResponse.json({ ok: true, id, data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
