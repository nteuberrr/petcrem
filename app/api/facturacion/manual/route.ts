import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { emitirDocumento } from '@/lib/facturacion'
import { DTE_BOLETA_AFECTA, DTE_FACTURA_AFECTA, type LineaItem } from '@/lib/openfactura'

interface LineaBody { nombre?: string; cantidad?: number; montoBruto?: number; descripcion?: string }
interface Body {
  tipo?: number
  dev?: boolean
  receptor?: { nombre?: string; rut?: string; giro?: string; direccion?: string; comuna?: string; correo?: string }
  lineas?: LineaBody[]
}

/**
 * POST /api/facturacion/manual — emite una boleta (39) o factura (33) con datos
 * ingresados a mano (cliente sin ficha asociada, o cualquier receptor). Solo admin.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const user = session?.user as { role?: string; id?: string; name?: string } | undefined
  if (!esAdminTotal(user?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as Body
  const tipo = body.tipo === DTE_FACTURA_AFECTA ? DTE_FACTURA_AFECTA : DTE_BOLETA_AFECTA
  const nombre = (body.receptor?.nombre || '').trim()
  if (!nombre) return NextResponse.json({ error: 'Falta el nombre del receptor.' }, { status: 400 })

  const lineasBody = Array.isArray(body.lineas) ? body.lineas : []
  const lineas: LineaItem[] = lineasBody
    .filter(l => (l.nombre || '').trim() && Number(l.montoBruto) > 0)
    .map(l => ({
      nombre: String(l.nombre).trim(),
      cantidad: Number(l.cantidad) > 0 ? Number(l.cantidad) : 1,
      montoBruto: Math.round(Number(l.montoBruto)),
      descripcion: l.descripcion?.trim() || undefined,
    }))
  if (lineas.length === 0) return NextResponse.json({ error: 'Agrega al menos un ítem con monto mayor a 0.' }, { status: 400 })

  let rut = (body.receptor?.rut || '').trim()
  if (tipo === DTE_FACTURA_AFECTA && !rut) {
    return NextResponse.json({ error: 'La factura requiere el RUT del receptor.' }, { status: 400 })
  }
  if (!rut) rut = '66666666-6' // consumidor final (boleta sin RUT)

  const resumen = lineas.length === 1 ? lineas[0].nombre : `${lineas.length} ítems`

  const r = await emitirDocumento({
    tipo,
    receptorTipo: 'manual',
    receptor: {
      RUTRecep: rut,
      RznSocRecep: nombre,
      GiroRecep: body.receptor?.giro?.trim() || undefined,
      DirRecep: body.receptor?.direccion?.trim() || undefined,
      CmnaRecep: body.receptor?.comuna?.trim() || undefined,
      CorreoRecep: body.receptor?.correo?.trim() || undefined,
    },
    lineas,
    resumen,
    cliente: { nombre, email: body.receptor?.correo?.trim() },
    dev: !!body.dev,
    creadoPorId: user?.id || '',
    creadoPorNombre: user?.name || '',
  })

  if (!r.ok) return NextResponse.json({ error: r.error || 'No se pudo emitir el documento.' }, { status: 502 })
  return NextResponse.json({ ok: true, documento: r.documento, warnings: r.warnings }, { status: 201 })
}
