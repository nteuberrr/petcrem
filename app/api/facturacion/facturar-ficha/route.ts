import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { getSheetData } from '@/lib/datastore'
import { emitirDocumento, enviarCopiaFacturaOwner } from '@/lib/facturacion'
import { calcularPrecioFicha, type Tramo } from '@/lib/ficha-precio'
import { formatDateForSheet } from '@/lib/dates'
import { DTE_FACTURA_AFECTA, type LineaItem } from '@/lib/openfactura'

const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/**
 * POST /api/facturacion/facturar-ficha  { fichaId, dev? }
 * Emite UNA factura (33) por una sola ficha de convenio (el dueño pidió poder
 * facturar servicio por servicio, aparte del lote mensual). Recalcula el monto en
 * el servidor (snapshot o en vivo), marca la ficha como facturada y manda copia
 * al dueño. Solo admin-total.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const user = session?.user as { role?: string; id?: string; name?: string } | undefined
  if (!esAdminTotal(user?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as { fichaId?: string; dev?: boolean }
  const fichaId = String(body.fichaId || '').trim()
  if (!fichaId) return NextResponse.json({ error: 'Falta fichaId.' }, { status: 400 })

  const [clientes, vets, preciosG, preciosC, preciosE] = await Promise.all([
    getSheetData('clientes'),
    getSheetData('veterinarios'),
    getSheetData('precios_generales'),
    getSheetData('precios_convenio'),
    getSheetData('precios_especiales').catch(() => [] as Record<string, string>[]),
  ])

  const c = clientes.find(r => String(r.id) === fichaId)
  if (!c) return NextResponse.json({ error: 'Ficha no encontrada.' }, { status: 404 })
  const vetId = String(c.veterinaria_id || '').trim()
  if (!vetId) return NextResponse.json({ error: 'Esta ficha no es de convenio (no lleva factura).' }, { status: 400 })
  if (String(c.estado || '') === 'borrador' || !String(c.codigo || '').trim()) {
    return NextResponse.json({ error: 'La ficha no está registrada todavía.' }, { status: 400 })
  }
  if (String(c.factura_vet_id || '').trim()) {
    return NextResponse.json({ error: 'Esta ficha ya fue facturada.' }, { status: 409 })
  }

  const vet = vets.find(v => String(v.id) === vetId)
  if (!vet) return NextResponse.json({ error: 'La veterinaria no existe.' }, { status: 400 })
  if (!String(vet.rut || '').trim()) {
    return NextResponse.json({ error: 'La veterinaria no tiene RUT registrado (requerido para factura). Complétalo en Veterinarios.' }, { status: 400 })
  }

  const especialesDeVet = (preciosE as unknown as Tramo[]).filter(t => t.veterinaria_id === vetId)
  const precio = calcularPrecioFicha(c, vet.tipo_precios, {
    generales: preciosG as unknown as Tramo[],
    convenio: preciosC as unknown as Tramo[],
    especialesDeVet,
  })
  if (precio.total <= 0) {
    return NextResponse.json({ error: 'La ficha no tiene monto para facturar.' }, { status: 400 })
  }

  const servicio = (c.codigo_servicio || 'CI').toUpperCase()
  const mascota = c.nombre_mascota || 'mascota'
  const lineas: LineaItem[] = [{
    nombre: `Cremación ${servicio} — ${mascota} (${c.codigo || c.id})`.slice(0, 80),
    cantidad: 1,
    montoBruto: precio.total,
  }]

  const fISO = formatDateForSheet(c.fecha_retiro) || ''
  const mes = fISO ? fISO.slice(0, 7) : ''
  const mesLabel = mes ? `${MESES_ES[parseInt(mes.slice(5, 7), 10) - 1]} ${mes.slice(0, 4)}` : ''

  const r = await emitirDocumento({
    tipo: DTE_FACTURA_AFECTA,
    receptorTipo: 'veterinaria',
    receptorId: vetId,
    receptor: {
      RUTRecep: vet.rut,
      RznSocRecep: vet.razon_social || vet.nombre,
      GiroRecep: vet.giro || undefined,
      DirRecep: vet.direccion || undefined,
      CmnaRecep: vet.comuna || undefined,
      CorreoRecep: vet.correo || undefined,
    },
    lineas,
    resumen: `Cremación ${c.codigo || ''} · ${mascota}`.trim(),
    mesFacturado: mes,
    fichasJson: [{ id: String(c.id), codigo: c.codigo || '' }],
    permitirFactura: true,
    dev: !!body.dev,
    creadoPorId: user?.id || '',
    creadoPorNombre: user?.name || '',
  })

  if (!r.ok) return NextResponse.json({ error: r.error || 'No se pudo emitir la factura.' }, { status: 502 })

  if (r.documento) {
    await enviarCopiaFacturaOwner(r.documento, {
      vetNombre: vet.nombre || vet.razon_social || 'Veterinaria',
      mesLabel,
      fichas: [{ codigo: c.codigo || '', nombre_mascota: mascota, monto: precio.total }],
    })
  }

  return NextResponse.json({
    ok: true,
    folio: r.documento?.folio || '',
    documentoId: r.documento?.id || '',
    monto: precio.total,
  })
}
