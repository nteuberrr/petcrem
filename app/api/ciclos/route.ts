import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSheetData, appendRow, updateRow, getNextId, ensureColumn } from '@/lib/google-sheets'

const CicloSchema = z.object({
  fecha: z.string().min(1),
  litros_inicio: z.number(),
  litros_fin: z.number(),
  mascotas_ids: z.array(z.string()),
  comentarios: z.string().optional().default(''),
  hora_inicio: z.string().optional().default(''),
  hora_fin: z.string().optional().default(''),
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

    await ensureColumn('ciclos', 'hora_inicio')
    await ensureColumn('ciclos', 'hora_fin')

    const id = await getNextId('ciclos')
    const now = new Date().toISOString().split('T')[0]

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
      fecha_creacion: now,
    }
    await appendRow('ciclos', row)

    // Actualizar clientes incluidos a estado "cremado"
    const clientes = await getSheetData('clientes')
    for (const mascotaId of data.mascotas_ids) {
      const idx = clientes.findIndex((c) => c.id === mascotaId)
      if (idx !== -1) {
        await updateRow('clientes', idx, {
          ...clientes[idx],
          estado: 'cremado',
          ciclo_id: id,
        })
      }
    }

    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}
