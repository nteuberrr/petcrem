import { NextRequest, NextResponse } from 'next/server'
import { reorderColumns } from '@/lib/google-sheets'

// Mapa de schemas por hoja. Debe quedar sincronizado con init-sheets/route.ts.
const SCHEMAS: Record<string, string[]> = {
  clientes: [
    'id', 'codigo', 'nombre_mascota', 'nombre_tutor',
    'email', 'telefono',
    'direccion_retiro', 'direccion_despacho', 'misma_direccion', 'comuna',
    'fecha_retiro', 'fecha_defuncion',
    'especie', 'letra_especie',
    'peso_declarado', 'peso_ingreso', 'peso_kg',
    'tipo_servicio', 'codigo_servicio',
    'estado', 'ciclo_id', 'despacho_id',
    'veterinaria_id', 'tipo_precios', 'adicionales',
    'notas', 'tipo_pago', 'estado_pago',
    'fecha_creacion',
  ],
}

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const sheet = searchParams.get('sheet')
    if (!sheet) return NextResponse.json({ error: 'Falta ?sheet=<nombre_de_hoja>' }, { status: 400 })
    const desired = SCHEMAS[sheet]
    if (!desired) return NextResponse.json({ error: `Hoja "${sheet}" no tiene schema definido. Opciones: ${Object.keys(SCHEMAS).join(', ')}` }, { status: 400 })
    const result = await reorderColumns(sheet, desired)
    return NextResponse.json({ ok: true, sheet, ...result })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return POST(req)
}
