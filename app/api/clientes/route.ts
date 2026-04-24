import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSheetData, appendRow, getNextId, ensureColumns } from '@/lib/google-sheets'
import { generarCodigo } from '@/lib/codigo-generator'
import { todayISO } from '@/lib/dates'

const ClienteSchema = z.object({
  nombre_mascota: z.string().min(1, 'Nombre de mascota requerido'),
  nombre_tutor: z.string().min(1, 'Nombre de tutor requerido'),
  email: z.string().email('Email inválido'),
  telefono: z.string().min(1, 'Teléfono requerido'),
  direccion_retiro: z.string().min(1, 'Dirección de retiro requerida'),
  direccion_despacho: z.string().min(1, 'Dirección de despacho requerida'),
  misma_direccion: z.boolean(),
  comuna: z.string().min(1, 'Comuna requerida'),
  fecha_retiro: z.string().min(1, 'Fecha de retiro requerida'),
  especie: z.string().min(1, 'Especie requerida'),
  letra_especie: z.string().length(1),
  // Compat: acepta peso_declarado (nuevo) o peso_kg (legacy)
  peso_declarado: z.number().positive().optional(),
  peso_kg: z.number().positive().optional(),
  peso_ingreso: z.number().positive().optional(),
  tipo_servicio: z.string().min(1, 'Servicio requerido'),
  codigo_servicio: z.enum(['CI', 'CP', 'SD']),
  tipo_pago: z.string().min(1, 'Tipo de pago requerido'),
  estado_pago: z.string().min(1, 'Estado de pago requerido'),
  veterinaria_id: z.string().optional(),
  adicionales: z.string().optional(),
}).refine(d => d.peso_declarado !== undefined || d.peso_kg !== undefined, {
  message: 'peso_declarado (o peso_kg) es requerido',
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
    await ensureColumns('clientes', [
      'email', 'telefono',
      'veterinaria_id', 'adicionales', 'tipo_precios',
      'peso_declarado', 'peso_ingreso', 'despacho_id',
      'fecha_defuncion', 'notas', 'tipo_pago', 'estado_pago',
    ])
    const codigo = await generarCodigo(data.letra_especie, data.codigo_servicio)
    const id = await getNextId('clientes')
    const now = todayISO()
    const pesoDeclarado = data.peso_declarado ?? data.peso_kg ?? 0
    const row = {
      id,
      codigo,
      nombre_mascota: data.nombre_mascota,
      nombre_tutor: data.nombre_tutor,
      email: data.email,
      telefono: data.telefono,
      direccion_retiro: data.direccion_retiro,
      direccion_despacho: data.misma_direccion ? data.direccion_retiro : data.direccion_despacho,
      misma_direccion: data.misma_direccion ? 'TRUE' : 'FALSE',
      comuna: data.comuna,
      fecha_retiro: data.fecha_retiro,
      especie: data.especie,
      letra_especie: data.letra_especie,
      // Escribe ambas columnas: peso_declarado (nueva) y peso_kg (legacy) para compat
      peso_declarado: String(pesoDeclarado),
      peso_kg: String(pesoDeclarado),
      peso_ingreso: data.peso_ingreso !== undefined ? String(data.peso_ingreso) : '',
      tipo_servicio: data.tipo_servicio,
      codigo_servicio: data.codigo_servicio,
      estado: 'pendiente',
      ciclo_id: '',
      despacho_id: '',
      veterinaria_id: data.veterinaria_id ?? '',
      adicionales: data.adicionales ?? '[]',
      tipo_pago: data.tipo_pago,
      estado_pago: data.estado_pago,
      fecha_creacion: now,
    }
    await appendRow('clientes', row)
    return NextResponse.json({ ...row }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}
