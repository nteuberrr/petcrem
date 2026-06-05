import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, appendRow, updateRow, deleteRow, getNextId, ensureSheet, ensureColumns } from '@/lib/google-sheets'
import { todayISO } from '@/lib/dates'
import { buscarComuna } from '@/lib/comunas'

const SHEET = 'vet_convenio_eutanasia'
const COLS = [
  'id', 'nombre', 'email', 'telefono', 'rut',
  'comunas', 'horarios',
  'activo', 'origen', 'notas',
  'total_servicios',
  'fecha_inscripcion', 'fecha_creacion',
]

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if ((session?.user as { role?: string })?.role !== 'admin') {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  return null
}

/**
 * Normaliza un array de nombres de comuna a la forma canónica (con tildes,
 * mayúsculas correctas). Filtra los que no existen en la lista oficial.
 */
function normalizarComunas(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  const vistos = new Set<string>()
  for (const raw of input) {
    if (typeof raw !== 'string') continue
    const c = buscarComuna(raw)
    if (!c) continue
    if (vistos.has(c.nombre)) continue
    vistos.add(c.nombre)
    out.push(c.nombre)
  }
  return out
}

interface HorariosDia { am?: boolean; pm?: boolean }
type HorariosSemana = Partial<Record<'lun' | 'mar' | 'mie' | 'jue' | 'vie' | 'sab' | 'dom', HorariosDia>>

/** Valida y limpia el objeto de horarios. */
function normalizarHorarios(input: unknown): HorariosSemana {
  if (!input || typeof input !== 'object') return {}
  const out: HorariosSemana = {}
  const dias = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'] as const
  for (const d of dias) {
    const v = (input as Record<string, unknown>)[d]
    if (v && typeof v === 'object') {
      const dia = v as { am?: unknown; pm?: unknown }
      const am = !!dia.am
      const pm = !!dia.pm
      if (am || pm) out[d] = { am, pm }
    }
  }
  return out
}

function validarEmail(s: string): boolean {
  return /^[^\s,;<>"()@]+@[^\s,;<>"()@]+\.[^\s,;<>"()@]+$/i.test(s.trim())
}

export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    await ensureSheet(SHEET)
    await ensureColumns(SHEET, COLS)
    const rows = await getSheetData(SHEET)
    // Parsear JSON de comunas y horarios para el frontend.
    const out: Record<string, unknown>[] = rows.map(r => ({
      ...r,
      comunas_array: r.comunas ? safeParseArray(r.comunas) : [],
      horarios_obj: r.horarios ? safeParseObj(r.horarios) : {},
    }))
    out.sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'))
    return NextResponse.json(out)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

function safeParseArray(s: string): string[] {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : [] } catch { return [] }
}
function safeParseObj(s: string): Record<string, unknown> {
  try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : {} } catch { return {} }
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const body = await req.json()
    if (!body.nombre || !String(body.nombre).trim()) {
      return NextResponse.json({ error: 'nombre es requerido' }, { status: 400 })
    }
    if (!body.email || !validarEmail(String(body.email))) {
      return NextResponse.json({ error: 'email inválido' }, { status: 400 })
    }
    const comunas = normalizarComunas(body.comunas)
    const horarios = normalizarHorarios(body.horarios)

    await ensureSheet(SHEET)
    await ensureColumns(SHEET, COLS)

    const id = await getNextId(SHEET)
    const hoy = todayISO()
    const row = {
      id,
      nombre: String(body.nombre).trim(),
      email: String(body.email).trim().toLowerCase(),
      telefono: String(body.telefono ?? '').trim(),
      rut: String(body.rut ?? '').trim(),
      comunas: JSON.stringify(comunas),
      horarios: JSON.stringify(horarios),
      activo: body.activo === false ? 'FALSE' : 'TRUE',
      origen: body.origen === 'publico' ? 'publico' : 'manual',
      notas: String(body.notas ?? '').trim(),
      total_servicios: '0',
      fecha_inscripcion: hoy,
      fecha_creacion: hoy,
    }
    await appendRow(SHEET, row)
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const body = await req.json()
    const { id, ...updates } = body
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    const rows = await getSheetData(SHEET)
    const idx = rows.findIndex(r => r.id === String(id))
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    const partial: Record<string, string> = {}
    if (typeof updates.nombre === 'string') partial.nombre = updates.nombre.trim()
    if (typeof updates.email === 'string') {
      if (!validarEmail(updates.email)) return NextResponse.json({ error: 'email inválido' }, { status: 400 })
      partial.email = updates.email.trim().toLowerCase()
    }
    if (typeof updates.telefono === 'string') partial.telefono = updates.telefono.trim()
    if (typeof updates.rut === 'string') partial.rut = updates.rut.trim()
    if ('comunas' in updates) partial.comunas = JSON.stringify(normalizarComunas(updates.comunas))
    if ('horarios' in updates) partial.horarios = JSON.stringify(normalizarHorarios(updates.horarios))
    if ('activo' in updates) partial.activo = updates.activo === true || updates.activo === 'TRUE' ? 'TRUE' : 'FALSE'
    if (typeof updates.notas === 'string') partial.notas = updates.notas.trim()

    const updated = { ...rows[idx], ...partial }
    await updateRow(SHEET, idx, updated)
    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    const rows = await getSheetData(SHEET)
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    await deleteRow(SHEET, idx)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
