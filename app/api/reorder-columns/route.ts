import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { reorderColumns } from '@/lib/datastore'

// Ruta pública en proxy, pero la auth vive acá (mismo criterio que init-sheets):
// sesión admin total O Authorization: Bearer <CRON_SECRET>. Fail-closed: sin
// CRON_SECRET, el Bearer no abre nada.
function bearerValido(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const auth = req.headers.get('authorization') || ''
  const a = crypto.createHash('sha256').update(auth).digest()
  const b = crypto.createHash('sha256').update(`Bearer ${secret}`).digest()
  return crypto.timingSafeEqual(a, b)
}

// Mapa de schemas por hoja. Debe quedar sincronizado con init-sheets/route.ts.
const SCHEMAS: Record<string, string[]> = {
  clientes: [
    'id', 'codigo', 'nombre_mascota', 'nombre_tutor',
    'email', 'telefono',
    'direccion_retiro', 'direccion_despacho', 'misma_direccion', 'comuna',
    'fecha_retiro', 'fecha_defuncion',
    'especie', 'letra_especie',
    'peso_declarado', 'peso_ingreso',
    'tipo_servicio', 'codigo_servicio',
    'estado', 'ciclo_id', 'despacho_id',
    'veterinaria_id', 'tipo_precios', 'adicionales',
    'notas', 'tipo_pago', 'estado_pago',
    'fecha_creacion',
  ],
}

export async function POST(req: NextRequest) {
  try {
    if (!bearerValido(req)) {
      const session = await getServerSession(authOptions)
      if (!esAdminTotal((session?.user as { role?: string })?.role)) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
      }
    }
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
