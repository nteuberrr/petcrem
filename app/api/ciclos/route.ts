import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSheetData, appendRow, updateRow, getNextId, ensureColumns, deleteRow } from '@/lib/google-sheets'
import { todayISO } from '@/lib/dates'
import { parsePeso } from '@/lib/numbers'

export const dynamic = 'force-dynamic'

const CicloSchema = z.object({
  fecha: z.string().min(1),
  litros_inicio: z.number(),
  litros_fin: z.number(),
  mascotas_ids: z.array(z.string()),
  comentarios: z.string().optional().default(''),
  hora_inicio: z.string().optional().default(''),
  hora_fin: z.string().optional().default(''),
  temperatura_camara: z.string().optional().default(''),
})

export async function GET() {
  try {
    const rows = await getSheetData('ciclos')
    const parsed = rows.map((r) => ({
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
    const data = CicloSchema.parse(body)

    const ciclos = await getSheetData('ciclos')
    const numeros = ciclos.map(c => parseInt(c.numero_ciclo || '0', 10)).filter(n => !isNaN(n))
    const numeroCiclo = (numeros.length ? Math.max(...numeros) : 0) + 1

    await ensureColumns('ciclos', ['hora_inicio', 'hora_fin', 'temperatura_camara', 'peso_total', 'lt_kg', 'lt_mascota'])

    const id = await getNextId('ciclos')
    const now = todayISO()

    // Calcular peso total + ratios para snapshot en planilla
    const clientes = await getSheetData('clientes')
    const idxById = new Map(clientes.map((c, i) => [c.id, i]))
    const pesoTotal = data.mascotas_ids.reduce((sum, mid) => {
      const idx = idxById.get(mid)
      if (idx === undefined) return sum
      const m = clientes[idx]
      const peso = parseFloat(m.peso_ingreso) || parseFloat(m.peso_declarado) || 0
      return sum + peso
    }, 0)
    const litrosUsados = Math.abs(data.litros_fin - data.litros_inicio)
    const ltKg = pesoTotal > 0 ? litrosUsados / pesoTotal : 0
    const ltMascota = data.mascotas_ids.length > 0 ? litrosUsados / data.mascotas_ids.length : 0

    const row = {
      id,
      fecha: data.fecha,
      numero_ciclo: numeroCiclo, // number crudo
      litros_inicio: data.litros_inicio,
      litros_fin: data.litros_fin,
      mascotas_ids: JSON.stringify(data.mascotas_ids),
      comentarios: data.comentarios,
      hora_inicio: data.hora_inicio ?? '',
      hora_fin: data.hora_fin ?? '',
      temperatura_camara: data.temperatura_camara ?? '',
      peso_total: pesoTotal,
      lt_kg: ltKg,
      lt_mascota: ltMascota,
      fecha_creacion: now,
    }
    await appendRow('ciclos', row)

    await Promise.all(
      data.mascotas_ids.map((mascotaId) => {
        const idx = idxById.get(mascotaId)
        if (idx === undefined) return Promise.resolve()
        return updateRow('clientes', idx, {
          ...clientes[idx],
          estado: 'cremado',
          ciclo_id: id,
        })
      })
    )

    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

/**
 * PATCH: edita un ciclo existente. No cambia las mascotas asociadas (eso requiere
 * recalcular estados de clientes); solo metadatos: fecha, litros, hora, temp, comentarios.
 * Si cambian los litros, recalcula peso_total/lt_kg/lt_mascota.
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { id, ...updates } = body
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    await ensureColumns('ciclos', ['hora_inicio', 'hora_fin', 'temperatura_camara', 'peso_total', 'lt_kg', 'lt_mascota'])

    const rows = await getSheetData('ciclos')
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    const updated: Record<string, unknown> = { ...rows[idx], ...updates }
    // Convertir numéricos
    if (updates.litros_inicio !== undefined) updated.litros_inicio = typeof updates.litros_inicio === 'number' ? updates.litros_inicio : parseFloat(updates.litros_inicio) || 0
    if (updates.litros_fin !== undefined) updated.litros_fin = typeof updates.litros_fin === 'number' ? updates.litros_fin : parseFloat(updates.litros_fin) || 0

    // Recalcular ratios si cambiaron los litros
    if (updates.litros_inicio !== undefined || updates.litros_fin !== undefined) {
      const lInicio = parseFloat(String(updated.litros_inicio)) || 0
      const lFin = parseFloat(String(updated.litros_fin)) || 0
      const litrosUsados = Math.abs(lInicio - lFin)

      // Recalcular peso_total leyendo clientes de las mascotas asociadas
      let mascotasIds: string[] = []
      try { mascotasIds = JSON.parse(String(updated.mascotas_ids || '[]')) } catch {}
      const clientes = await getSheetData('clientes')
      const clienteById = new Map(clientes.map(c => [c.id, c]))
      let pesoTotal = 0
      for (const mid of mascotasIds) {
        const c = clienteById.get(mid)
        if (c) pesoTotal += parsePeso(c.peso_ingreso) || parsePeso(c.peso_declarado)
      }
      updated.peso_total = pesoTotal
      updated.lt_kg = pesoTotal > 0 ? litrosUsados / pesoTotal : 0
      updated.lt_mascota = mascotasIds.length > 0 ? litrosUsados / mascotasIds.length : 0
    }

    await updateRow('ciclos', idx, updated)
    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

/**
 * DELETE: elimina un ciclo y revierte las mascotas asociadas a estado='pendiente'
 * con ciclo_id=''. Si las mascotas ya fueron despachadas, NO las toca.
 */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })

    const rows = await getSheetData('ciclos')
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    // Revertir mascotas asociadas: las que sigan en 'cremado' vuelven a 'pendiente'
    let mascotasIds: string[] = []
    try { mascotasIds = JSON.parse(rows[idx].mascotas_ids || '[]') } catch {}
    if (mascotasIds.length > 0) {
      const clientes = await getSheetData('clientes')
      const idxById = new Map(clientes.map((c, i) => [c.id, i]))
      await Promise.all(
        mascotasIds.map((mid) => {
          const cIdx = idxById.get(mid)
          if (cIdx === undefined) return Promise.resolve()
          // Solo revertir si seguía en cremado vinculada a este ciclo
          if (clientes[cIdx].estado === 'cremado' && clientes[cIdx].ciclo_id === id) {
            return updateRow('clientes', cIdx, { ...clientes[cIdx], estado: 'pendiente', ciclo_id: '' })
          }
          return Promise.resolve()
        })
      )
    }

    await deleteRow('ciclos', idx)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
