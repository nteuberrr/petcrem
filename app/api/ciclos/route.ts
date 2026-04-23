import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSheetData, appendRow, updateRow, getNextId, ensureColumns } from '@/lib/google-sheets'
import { todayISO } from '@/lib/dates'

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

    await ensureColumns('ciclos', ['hora_inicio', 'hora_fin', 'temperatura_camara'])

    const id = await getNextId('ciclos')
    const now = todayISO()

    const row = {
      id,
      fecha: data.fecha,
      numero_ciclo: String(numeroCiclo),
      litros_inicio: String(data.litros_inicio),
      litros_fin: String(data.litros_fin),
      mascotas_ids: JSON.stringify(data.mascotas_ids),
      comentarios: data.comentarios,
      hora_inicio: data.hora_inicio ?? '',
      hora_fin: data.hora_fin ?? '',
      temperatura_camara: data.temperatura_camara ?? '',
      fecha_creacion: now,
    }
    await appendRow('ciclos', row)

    // Actualizar clientes incluidos a estado "cremado"
    const clientes = await getSheetData('clientes')
    const idxById = new Map(clientes.map((c, i) => [c.id, i]))
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
