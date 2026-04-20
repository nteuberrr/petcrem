import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSheetData, appendRow, getNextId, ensureColumn } from '@/lib/google-sheets'
import { generarCodigo } from '@/lib/codigo-generator'

const ClienteSchema = z.object({
  nombre_mascota: z.string().min(1),
  nombre_tutor: z.string().min(1),
  direccion_retiro: z.string().min(1),
  direccion_despacho: z.string(),
  misma_direccion: z.boolean(),
  comuna: z.string().min(1),
  fecha_retiro: z.string().min(1),
  especie: z.string().min(1),
  letra_especie: z.string().length(1),
  peso_kg: z.number().positive(),
  tipo_servicio: z.string().min(1),
  codigo_servicio: z.enum(['CI', 'CP', 'SD']),
  veterinaria_id: z.string().optional(),
  adicionales: z.string().optional(),
})

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const estado = searchParams.get('estado')
    const buscar = searchParams.get('buscar')
    let rows = await getSheetData('clientes')
    if (estado) rows = rows.filter((r) => r.estado === estado)
    if (buscar) {
      const q = buscar.toLowerCase()
      rows = rows.filter(
        (r) =>
          r.nombre_mascota?.toLowerCase().includes(q) ||
          r.nombre_tutor?.toLowerCase().includes(q) ||
          r.codigo?.toLowerCase().includes(q)
      )
    }
    return NextResponse.json(rows)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const data = ClienteSchema.parse(body)
    await ensureColumn('clientes', 'veterinaria_id')
    await ensureColumn('clientes', 'adicionales')
    const codigo = await generarCodigo(data.letra_especie, data.codigo_servicio)
    const id = await getNextId('clientes')
    const now = new Date().toISOString().split('T')[0]
    const row = {
      id,
      codigo,
      nombre_mascota: data.nombre_mascota,
      nombre_tutor: data.nombre_tutor,
      direccion_retiro: data.direccion_retiro,
      direccion_despacho: data.misma_direccion ? data.direccion_retiro : data.direccion_despacho,
      misma_direccion: data.misma_direccion ? 'TRUE' : 'FALSE',
      comuna: data.comuna,
      fecha_retiro: data.fecha_retiro,
      especie: data.especie,
      letra_especie: data.letra_especie,
      peso_kg: String(data.peso_kg),
      tipo_servicio: data.tipo_servicio,
      codigo_servicio: data.codigo_servicio,
      estado: 'pendiente',
      ciclo_id: '',
      veterinaria_id: data.veterinaria_id ?? '',
      adicionales: data.adicionales ?? '[]',
      fecha_creacion: now,
    }
    await appendRow('clientes', row)
    return NextResponse.json({ ...row }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}
