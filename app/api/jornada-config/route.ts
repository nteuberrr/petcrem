import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, appendRow, getNextId, ensureColumns, ensureSheet } from '@/lib/google-sheets'
import { todayISO, formatDateForSheet, formatHora } from '@/lib/dates'
import type { JornadaConfig } from '@/lib/asistencia'

const HOJA = 'jornada_config'
const COLS = ['id', 'vigente_desde', 'hora_entrada', 'hora_salida', 'precio_hora_extra', 'creado_por', 'fecha_creacion']

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
    const { vigente_desde, hora_entrada, hora_salida, precio_hora_extra } = body
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
      creado_por: session.user?.email ?? '',
      fecha_creacion: todayISO(),
    }
    await appendRow(HOJA, row)
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}
