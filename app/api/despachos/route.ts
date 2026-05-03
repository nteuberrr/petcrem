import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, appendRow, updateRow, getNextId, deleteRow, ensureColumns, ensureSheet } from '@/lib/google-sheets'
import { todayISO } from '@/lib/dates'

const HOJA = 'despachos'
const COLS = ['id', 'fecha', 'numero_recorrido', 'mascotas_ids', 'nota', 'fecha_creacion']

async function ensure() {
  await ensureSheet(HOJA)
  await ensureColumns(HOJA, COLS)
}

export async function GET() {
  try {
    await ensure()
    const rows = await getSheetData(HOJA)
    const parsed = rows.map(r => ({
      ...r,
      mascotas_ids: (() => {
        try { return JSON.parse(r.mascotas_ids || '[]') } catch { return [] }
      })(),
    }))
    return NextResponse.json(parsed.reverse())
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (!body.fecha || !Array.isArray(body.mascotas_ids) || body.mascotas_ids.length === 0) {
      return NextResponse.json({ error: 'fecha y al menos una mascota requeridas' }, { status: 400 })
    }
    await ensure()

    // Número correlativo por día
    const existentes = await getSheetData(HOJA)
    const delDia = existentes.filter(d => d.fecha === body.fecha)
    const numero = delDia.length + 1

    const id = await getNextId(HOJA)
    const now = todayISO()

    const row = {
      id,
      fecha: String(body.fecha),
      numero_recorrido: String(numero),
      mascotas_ids: JSON.stringify(body.mascotas_ids),
      nota: body.nota ?? '',
      fecha_creacion: now,
    }
    await appendRow(HOJA, row)

    // Marcar mascotas como despachadas y vincular despacho_id
    const clientes = await getSheetData('clientes')
    const idxById = new Map(clientes.map((c, i) => [c.id, i]))
    await Promise.all(
      (body.mascotas_ids as string[]).map((mid) => {
        const idx = idxById.get(mid)
        if (idx === undefined) return Promise.resolve()
        return updateRow('clientes', idx, {
          ...clientes[idx],
          estado: 'despachado',
          despacho_id: id,
        })
      })
    )

    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { id, fecha, nota, mascotas_ids } = body as {
      id: string
      fecha?: string
      nota?: string
      mascotas_ids?: string[]
    }
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    await ensure()
    const rows = await getSheetData(HOJA)
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    const updated: Record<string, string> = { ...rows[idx] }
    if (fecha !== undefined) updated.fecha = String(fecha)
    if (nota !== undefined) updated.nota = String(nota)

    // Diff de mascotas: si vienen, recalcular estados de clientes
    if (Array.isArray(mascotas_ids)) {
      let viejas: string[] = []
      try { viejas = JSON.parse(rows[idx].mascotas_ids || '[]') } catch { viejas = [] }
      const nuevasSet = new Set(mascotas_ids)
      const viejasSet = new Set(viejas)
      const quitadas = viejas.filter(m => !nuevasSet.has(m))
      const agregadas = mascotas_ids.filter(m => !viejasSet.has(m))

      if (quitadas.length > 0 || agregadas.length > 0) {
        const clientes = await getSheetData('clientes')
        const idxById = new Map(clientes.map((c, i) => [c.id, i]))
        await Promise.all([
          ...quitadas.map((mid) => {
            const cIdx = idxById.get(mid)
            if (cIdx === undefined) return Promise.resolve()
            return updateRow('clientes', cIdx, { ...clientes[cIdx], estado: 'cremado', despacho_id: '' })
          }),
          ...agregadas.map((mid) => {
            const cIdx = idxById.get(mid)
            if (cIdx === undefined) return Promise.resolve()
            return updateRow('clientes', cIdx, { ...clientes[cIdx], estado: 'despachado', despacho_id: id })
          }),
        ])
      }

      updated.mascotas_ids = JSON.stringify(mascotas_ids)
    }

    await updateRow(HOJA, idx, updated)
    return NextResponse.json({ ok: true, id })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
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

    // Revertir estado de mascotas a 'cremado'
    try {
      const mascotasIds: string[] = JSON.parse(rows[idx].mascotas_ids || '[]')
      const clientes = await getSheetData('clientes')
      const idxById = new Map(clientes.map((c, i) => [c.id, i]))
      await Promise.all(
        mascotasIds.map((mid) => {
          const cIdx = idxById.get(mid)
          if (cIdx === undefined) return Promise.resolve()
          return updateRow('clientes', cIdx, { ...clientes[cIdx], estado: 'cremado', despacho_id: '' })
        })
      )
    } catch (e) { console.warn('[despachos DELETE] revert estado fallo', id, e) }

    await deleteRow(HOJA, idx)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
