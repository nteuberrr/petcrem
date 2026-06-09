import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, appendRow, getNextId, deleteRow, ensureColumns, ensureSheet, updateRow } from '@/lib/datastore'
import { todayISO, formatDateForSheet } from '@/lib/dates'

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
    // Costo histórico: total bruto acumulado de todas las cargas (auto-rellena si solo
    // hay neto+iva+especifico para cargas viejas guardadas antes del rediseño del form).
    const totalCosto = cargas.reduce((s, r) => {
      const tb = parseFloat(r.total_bruto) || 0
      if (tb > 0) return s + tb
      return s + (parseFloat(r.precio_neto) || 0) + (parseFloat(r.iva) || 0) + (parseFloat(r.especifico) || 0)
    }, 0)
    const costoPromedioLitro = totalCargado > 0 ? totalCosto / totalCargado : 0

    // Serie evolutiva del costo por carga (orden cronológico ascendente).
    // Cada punto = una carga individual con su fecha + costo/litro de esa carga.
    // Útil para ver tendencia del precio del combustible a lo largo del tiempo.
    const costoEvolutivo = cargas
      .map(r => {
        const lts = parseFloat(r.litros) || 0
        const tb = parseFloat(r.total_bruto) || 0
        const totalFb = tb > 0 ? tb : ((parseFloat(r.precio_neto) || 0) + (parseFloat(r.iva) || 0) + (parseFloat(r.especifico) || 0))
        const iso = formatDateForSheet(r.fecha)
        return {
          fecha: iso,
          fecha_label: iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: '2-digit' }) : '',
          litros: lts,
          costo: totalFb,
          costo_litro: lts > 0 ? totalFb / lts : 0,
        }
      })
      .filter(p => p.fecha && p.litros > 0 && p.costo > 0)
      .sort((a, b) => a.fecha.localeCompare(b.fecha))

    return NextResponse.json({
      cargas: cargas.reverse(),
      resumen: { total_cargado: totalCargado, total_consumido: totalConsumido, stock_actual: stock, ciclos_count: ciclos.length, total_costo: totalCosto, costo_promedio_litro: costoPromedioLitro },
      costo_evolutivo: costoEvolutivo,
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
    // Números crudos (no String) para que Sheets respete formato decimal del locale es-CL
    const row = {
      id,
      fecha: String(body.fecha),
      litros: parseFloat(body.litros) || 0,
      precio_neto: neto,
      iva: iva,
      especifico: esp,
      total_bruto: total,
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
    const updated: Record<string, unknown> = { ...rows[idx], ...updates }
    // Convertir numéricos a number crudo
    if (updates.litros !== undefined) updated.litros = parseFloat(updates.litros) || 0
    if (updates.precio_neto !== undefined) updated.precio_neto = parseFloat(updates.precio_neto) || 0
    if (updates.iva !== undefined) updated.iva = parseFloat(updates.iva) || 0
    if (updates.especifico !== undefined) updated.especifico = parseFloat(updates.especifico) || 0
    // total_bruto autoritativo si viene en el body. Si no, deriva de neto+iva+esp.
    if (updates.total_bruto !== undefined) {
      updated.total_bruto = parseFloat(String(updates.total_bruto)) || 0
    } else if (updates.precio_neto !== undefined || updates.iva !== undefined || updates.especifico !== undefined) {
      const neto = parseFloat(String(updated.precio_neto)) || 0
      const iva = parseFloat(String(updated.iva)) || 0
      const esp = parseFloat(String(updated.especifico)) || 0
      updated.total_bruto = neto + iva + esp
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
