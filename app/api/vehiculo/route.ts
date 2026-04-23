import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, appendRow, getNextId, deleteRow, ensureColumns, ensureSheet } from '@/lib/google-sheets'
import { todayISO } from '@/lib/dates'

const HOJA = 'vehiculo_cargas'
const COLS = ['id', 'fecha', 'litros', 'km_odometro', 'monto', 'comentarios', 'fecha_creacion']

async function ensure() {
  await ensureSheet(HOJA)
  await ensureColumns(HOJA, COLS)
}

export async function GET() {
  try {
    await ensure()
    const rows = await getSheetData(HOJA)
    // Orden cronológico ascendente por km_odometro para cálculos
    const sorted = rows.slice().sort((a, b) => (parseFloat(a.km_odometro) || 0) - (parseFloat(b.km_odometro) || 0))

    const totalLitros = sorted.reduce((s, r) => s + (parseFloat(r.litros) || 0), 0)
    const totalMonto = sorted.reduce((s, r) => s + (parseFloat(r.monto) || 0), 0)
    const kms = sorted.map(r => parseFloat(r.km_odometro) || 0)
    const kmTotales = kms.length >= 2 ? kms[kms.length - 1] - kms[0] : 0
    // Rendimiento promedio: km entre carga N y carga N+1, dividido por litros cargados en N+1
    // Consumo entre dos cargas = litros cargados en la carga siguiente (repone lo gastado)
    let rendimiento = 0
    if (sorted.length >= 2) {
      const litrosEntre = sorted.slice(1).reduce((s, r) => s + (parseFloat(r.litros) || 0), 0)
      rendimiento = litrosEntre > 0 ? kmTotales / litrosEntre : 0
    }

    // Rendimiento mes por mes
    const porMes: Record<string, { km: number; litros: number }> = {}
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]
      const cur = sorted[i]
      const deltaKm = (parseFloat(cur.km_odometro) || 0) - (parseFloat(prev.km_odometro) || 0)
      const litros = parseFloat(cur.litros) || 0
      const fecha = new Date(cur.fecha || cur.fecha_creacion)
      if (isNaN(fecha.getTime())) continue
      const key = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`
      if (!porMes[key]) porMes[key] = { km: 0, litros: 0 }
      porMes[key].km += deltaKm
      porMes[key].litros += litros
    }
    const mensual = Object.entries(porMes)
      .map(([mes, v]) => ({ mes, km: v.km, litros: v.litros, km_por_litro: v.litros > 0 ? v.km / v.litros : 0 }))
      .sort((a, b) => a.mes.localeCompare(b.mes))

    return NextResponse.json({
      cargas: sorted.reverse(), // mostrar recientes primero (ya no se usa sorted después)
      resumen: { total_litros: totalLitros, total_km: kmTotales, total_monto: totalMonto, rendimiento_promedio: rendimiento },
      mensual,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (!body.fecha || body.litros === undefined || body.km_odometro === undefined) {
      return NextResponse.json({ error: 'fecha, litros y km_odometro requeridos' }, { status: 400 })
    }
    await ensure()
    const id = await getNextId(HOJA)
    const row = {
      id,
      fecha: String(body.fecha),
      litros: String(body.litros),
      km_odometro: String(body.km_odometro),
      monto: String(body.monto ?? 0),
      comentarios: body.comentarios ?? '',
      fecha_creacion: todayISO(),
    }
    await appendRow(HOJA, row)
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    await ensure()
    const rows = await getSheetData(HOJA)
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    await deleteRow(HOJA, idx)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
