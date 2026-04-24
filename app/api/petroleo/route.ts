import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, appendRow, getNextId, deleteRow, ensureColumns, ensureSheet, updateRow } from '@/lib/google-sheets'
import { todayISO } from '@/lib/dates'

const HOJA = 'cargas_petroleo'
const COLS = ['id', 'fecha', 'litros', 'precio_neto', 'iva', 'especifico', 'total_bruto', 'notas', 'fecha_creacion']

async function ensure() {
  await ensureSheet(HOJA)
  await ensureColumns(HOJA, COLS)
}

export async function GET() {
  try {
    await ensure()
    const rows = await getSheetData(HOJA)
    const ciclos = await getSheetData('ciclos')
    const cargas = rows.slice().sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''))
    const totalCargado = cargas.reduce((s, r) => s + (parseFloat(r.litros) || 0), 0)
    const totalConsumido = ciclos.reduce((s, c) => {
      const ini = parseFloat(c.litros_inicio) || 0
      const fin = parseFloat(c.litros_fin) || 0
      return s + Math.abs(fin - ini) // se gastan litros sin importar el sentido de la resta
    }, 0)
    const stock = totalCargado - totalConsumido
    return NextResponse.json({
      cargas: cargas.reverse(),
      resumen: { total_cargado: totalCargado, total_consumido: totalConsumido, stock_actual: stock, ciclos_count: ciclos.length },
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (!body.fecha || body.litros === undefined) {
      return NextResponse.json({ error: 'fecha y litros son requeridos' }, { status: 400 })
    }
    await ensure()
    const id = await getNextId(HOJA)
    const neto = parseFloat(body.precio_neto) || 0
    const iva = parseFloat(body.iva) || 0
    const esp = parseFloat(body.especifico) || 0
    const total = body.total_bruto !== undefined ? parseFloat(body.total_bruto) || 0 : neto + iva + esp
    const row = {
      id,
      fecha: String(body.fecha),
      litros: String(body.litros),
      precio_neto: String(neto),
      iva: String(iva),
      especifico: String(esp),
      total_bruto: String(total),
      notas: body.notas ?? '',
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
    await ensure()
    const body = await req.json()
    const { id, ...updates } = body
    const rows = await getSheetData(HOJA)
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    const updated = { ...rows[idx], ...updates }
    if (updates.precio_neto !== undefined || updates.iva !== undefined || updates.especifico !== undefined) {
      const neto = parseFloat(updated.precio_neto) || 0
      const iva = parseFloat(updated.iva) || 0
      const esp = parseFloat(updated.especifico) || 0
      updated.total_bruto = String(neto + iva + esp)
    }
    await updateRow(HOJA, idx, updated)
    return NextResponse.json(updated)
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
