import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, appendRow, updateRow, ensureSheet, ensureColumns } from '@/lib/google-sheets'
import { todayISO } from '@/lib/dates'

const SHEET = 'empresa_config'
const COLS = ['id', 'nombre', 'rut', 'giro', 'direccion', 'comuna', 'telefono', 'correo', 'web', 'instagram', 'facebook', 'fecha_actualizacion']

type EmpresaConfig = {
  id?: string
  nombre?: string
  rut?: string
  giro?: string
  direccion?: string
  comuna?: string
  telefono?: string
  correo?: string
  web?: string
  instagram?: string
  facebook?: string
  fecha_actualizacion?: string
}

const EMPTY: EmpresaConfig = {
  id: '1', nombre: '', rut: '', giro: '',
  direccion: '', comuna: '',
  telefono: '', correo: '',
  web: '', instagram: '', facebook: '',
  fecha_actualizacion: '',
}

export async function GET() {
  try {
    await ensureSheet(SHEET)
    await ensureColumns(SHEET, COLS)
    const rows = await getSheetData(SHEET)
    const row = rows.find(r => r.id === '1') || rows[0]
    return NextResponse.json(row || EMPTY)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if ((session?.user as { role?: string })?.role !== 'admin') {
      return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
    }
    const body = (await req.json().catch(() => ({}))) as EmpresaConfig

    await ensureSheet(SHEET)
    await ensureColumns(SHEET, COLS)
    const rows = await getSheetData(SHEET)
    const idx = rows.findIndex(r => r.id === '1')

    const data: Record<string, string> = {
      id: '1',
      nombre: body.nombre ?? '',
      rut: body.rut ?? '',
      giro: body.giro ?? '',
      direccion: body.direccion ?? '',
      comuna: body.comuna ?? '',
      telefono: body.telefono ?? '',
      correo: body.correo ?? '',
      web: body.web ?? '',
      instagram: body.instagram ?? '',
      facebook: body.facebook ?? '',
      fecha_actualizacion: todayISO(),
    }

    if (idx === -1) {
      await appendRow(SHEET, data)
    } else {
      await updateRow(SHEET, idx, data)
    }
    return NextResponse.json({ ok: true, data })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
