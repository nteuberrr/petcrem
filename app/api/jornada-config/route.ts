import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, appendRow, updateRow, deleteRow, getNextId, ensureColumns, ensureSheet } from '@/lib/google-sheets'
import { todayISO, formatDateForSheet, formatHora } from '@/lib/dates'
import type { JornadaConfig } from '@/lib/asistencia'

const HOJA = 'jornada_config'
const COLS = ['id', 'vigente_desde', 'hora_entrada', 'hora_salida', 'precio_hora_extra', 'tolerancia_minutos', 'creado_por', 'fecha_creacion']

async function ensure() {
  await ensureSheet(HOJA)
  await ensureColumns(HOJA, COLS)
}

export async function GET() {
  try {
    await ensure()
    const session = await getServerSession(authOptions)
    const isAdmin = session?.user?.role === 'admin'
    const rows = await getSheetData(HOJA)
    // Normalizar fechas y números. Operadores no deben ver precio_hora_extra.
    const configs: JornadaConfig[] = rows.map(r => ({
      id: r.id,
      vigente_desde: formatDateForSheet(r.vigente_desde) || r.vigente_desde,
      hora_entrada: formatHora(r.hora_entrada),
      hora_salida: formatHora(r.hora_salida),
      precio_hora_extra: isAdmin ? (parseFloat(r.precio_hora_extra) || 0) : 0,
      tolerancia_minutos: parseInt(r.tolerancia_minutos || '0', 10) || 0,
    }))
    // Ordenar de más reciente a más vieja
    configs.sort((a, b) => b.vigente_desde.localeCompare(a.vigente_desde))
    return NextResponse.json({ configs, vigente: configs[0] ?? null })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user?.role !== 'admin') {
      return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
    }
    const body = await req.json()
    const { vigente_desde, hora_entrada, hora_salida, precio_hora_extra, tolerancia_minutos } = body
    if (!vigente_desde || !hora_entrada || !hora_salida || precio_hora_extra === undefined) {
      return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 })
    }
    await ensure()
    const id = await getNextId(HOJA)
    const row = {
      id,
      vigente_desde: String(vigente_desde),
      hora_entrada: String(hora_entrada),
      hora_salida: String(hora_salida),
      precio_hora_extra: parseFloat(precio_hora_extra) || 0,
      tolerancia_minutos: parseInt(String(tolerancia_minutos ?? '0'), 10) || 0,
      creado_por: session.user?.email ?? '',
      fecha_creacion: todayISO(),
    }
    await appendRow(HOJA, row)
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user?.role !== 'admin') {
      return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
    }
    const body = await req.json()
    const { id, vigente_desde, hora_entrada, hora_salida, precio_hora_extra, tolerancia_minutos } = body
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    await ensure()
    const rows = await getSheetData(HOJA)
    const idx = rows.findIndex(r => r.id === String(id))
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    const updates: Record<string, unknown> = {}
    if (vigente_desde !== undefined) updates.vigente_desde = String(vigente_desde)
    if (hora_entrada !== undefined) updates.hora_entrada = String(hora_entrada)
    if (hora_salida !== undefined) updates.hora_salida = String(hora_salida)
    if (precio_hora_extra !== undefined) updates.precio_hora_extra = parseFloat(String(precio_hora_extra)) || 0
    if (tolerancia_minutos !== undefined) updates.tolerancia_minutos = parseInt(String(tolerancia_minutos), 10) || 0
    const updated = { ...rows[idx], ...updates }
    await updateRow(HOJA, idx, updated)
    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user?.role !== 'admin') {
      return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
    }
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    const rows = await getSheetData(HOJA)
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    await deleteRow(HOJA, idx)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
