import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { guard } from '@/lib/remuneraciones/auth'
import { actualizarEmpleado, crearEmpleado, listarEmpleados } from '@/lib/remuneraciones/datos'
import { formatearRut, validarRut } from '@/lib/rut'

export const dynamic = 'force-dynamic'

const MontoNombrado = z.object({ nombre: z.string(), monto: z.number() })

const EmpleadoSchema = z.object({
  usuario_id: z.string().optional().default(''),
  nombre_completo: z.string().min(1, 'El nombre es obligatorio'),
  rut: z.string().optional().default(''),
  fecha_nacimiento: z.string().optional().default(''),
  nacionalidad: z.string().optional().default(''),
  direccion: z.string().optional().default(''),
  comuna: z.string().optional().default(''),
  email: z.string().optional().default(''),
  telefono: z.string().optional().default(''),
  cargo: z.string().optional().default(''),
  unidad_negocio: z.string().optional().default('CASA MATRIZ'),
  tipo_contrato: z.enum(['indefinido', 'plazo_fijo']).optional().default('plazo_fijo'),
  fecha_ingreso: z.string().optional().default(''),
  fecha_termino: z.string().optional().default(''),
  jornada_semanal_horas: z.number().optional().default(42),
  sueldo_base: z.number().optional().default(0),
  modalidad_variable: z.enum(['meta_liquido', 'monto_directo', 'ninguna']).optional().default('ninguna'),
  valor_por_cremacion: z.number().optional().default(0),
  haberes_no_imponibles: z.array(MontoNombrado).optional().default([]),
  afp: z.string().optional().default(''),
  prevision_salud: z.enum(['fonasa', 'isapre', 'no_tiene']).optional().default('fonasa'),
  isapre_codigo: z.string().optional().default(''),
  plan_salud_uf: z.number().optional().default(0),
  apv_monto: z.number().optional().default(0),
  apv_institucion: z.string().optional().default(''),
  banco: z.string().optional().default(''),
  tipo_cuenta: z.string().optional().default(''),
  numero_cuenta: z.string().optional().default(''),
  activo: z.boolean().optional().default(true),
  notas: z.string().optional().default(''),
})

export async function GET() {
  const g = await guard('ver')
  if (g.denegado) return g.denegado
  try {
    return NextResponse.json({ empleados: await listarEmpleados(true) })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const g = await guard('editar')
  if (g.denegado) return g.denegado
  try {
    const datos = EmpleadoSchema.parse(await req.json())
    if (datos.rut && !validarRut(datos.rut)) {
      return NextResponse.json({ error: 'El RUT no es válido (revisa el dígito verificador).' }, { status: 400 })
    }
    const empleado = await crearEmpleado({ ...datos, rut: datos.rut ? formatearRut(datos.rut) : '' })
    return NextResponse.json({ empleado }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  const g = await guard('editar')
  if (g.denegado) return g.denegado
  try {
    const body = await req.json()
    const id = String(body?.id || '')
    if (!id) return NextResponse.json({ error: 'Falta el id del empleado' }, { status: 400 })
    const datos = EmpleadoSchema.partial().parse(body)
    if (datos.rut && !validarRut(datos.rut)) {
      return NextResponse.json({ error: 'El RUT no es válido (revisa el dígito verificador).' }, { status: 400 })
    }
    const empleado = await actualizarEmpleado(id, {
      ...datos,
      ...(datos.rut ? { rut: formatearRut(datos.rut) } : {}),
    })
    if (!empleado) return NextResponse.json({ error: 'Empleado no encontrado' }, { status: 404 })
    return NextResponse.json({ empleado })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}
