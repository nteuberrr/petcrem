import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { construirPropuestaMes } from '@/lib/facturacion-vets'
import { emitirDocumento, enviarCopiaFacturaOwner } from '@/lib/facturacion'
import { DTE_FACTURA_AFECTA, type LineaItem } from '@/lib/openfactura'

const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

interface VetSeleccion { veterinaria_id: string; fichaIds: string[] }
interface Body { mes?: string; dev?: boolean; vets?: VetSeleccion[] }

interface ResultadoVet {
  veterinaria_id: string
  nombre: string
  ok: boolean
  folio?: string
  documentoId?: string
  fichasFacturadas?: number
  monto?: number
  error?: string
}

/**
 * POST /api/facturacion/facturar-vets — emite UNA factura por veterinaria con las
 * fichas seleccionadas de la propuesta del mes. Re-calcula la propuesta en el
 * servidor (no confía en montos del cliente) y solo factura las fichas cuyo id
 * venga en `fichaIds`. Emite SECUENCIAL (no Promise.all): cada emisión reserva un
 * id nuevo vía getNextId — paralelizar rompería la unicidad de folio/idempotencia.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const user = session?.user as { role?: string; id?: string; name?: string } | undefined
  if (!esAdminTotal(user?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as Body
  const mes = body.mes || ''
  if (!/^\d{4}-\d{2}$/.test(mes)) {
    return NextResponse.json({ error: 'Parámetro mes inválido (esperado YYYY-MM).' }, { status: 400 })
  }
  const seleccion = Array.isArray(body.vets) ? body.vets : []
  if (seleccion.length === 0) {
    return NextResponse.json({ error: 'No se seleccionó ninguna veterinaria.' }, { status: 400 })
  }

  const propuesta = await construirPropuestaMes(mes)
  const [y, m] = mes.split('-')
  const mesLabel = `${MESES_ES[parseInt(m, 10) - 1]} ${y}`

  const resultados: ResultadoVet[] = []

  for (const sel of seleccion) {
    const vetProp = propuesta.vets.find(v => v.veterinaria_id === sel.veterinaria_id)
    if (!vetProp) {
      resultados.push({ veterinaria_id: sel.veterinaria_id, nombre: '(no encontrada)', ok: false, error: 'La veterinaria no está en la propuesta de este mes (¿ya se facturó?).' })
      continue
    }
    const idsSeleccionados = new Set((sel.fichaIds || []).filter(Boolean))
    const fichas = vetProp.fichas.filter(f => idsSeleccionados.has(f.id))
    if (fichas.length === 0) {
      resultados.push({ veterinaria_id: sel.veterinaria_id, nombre: vetProp.nombre, ok: false, error: 'No quedaron fichas seleccionadas para esta veterinaria.' })
      continue
    }
    if (!vetProp.rut) {
      resultados.push({ veterinaria_id: sel.veterinaria_id, nombre: vetProp.nombre, ok: false, error: 'La veterinaria no tiene RUT registrado (requerido para factura). Complétalo en Veterinarios.' })
      continue
    }

    const lineas: LineaItem[] = fichas.map(f => ({
      nombre: `Cremación ${f.codigo_servicio} — ${f.nombre_mascota || 'mascota'} (${f.codigo || f.id})`.slice(0, 80),
      cantidad: 1,
      montoBruto: f.monto,
    }))
    const montoTotal = fichas.reduce((s, f) => s + f.monto, 0)

    // eslint-disable-next-line no-await-in-loop
    const r = await emitirDocumento({
      tipo: DTE_FACTURA_AFECTA,
      receptorTipo: 'veterinaria',
      receptorId: vetProp.veterinaria_id,
      receptor: {
        RUTRecep: vetProp.rut,
        RznSocRecep: vetProp.razon_social || vetProp.nombre,
        GiroRecep: vetProp.giro || undefined,
        DirRecep: vetProp.direccion || undefined,
        CmnaRecep: vetProp.comuna || undefined,
        CorreoRecep: vetProp.correo || undefined,
      },
      lineas,
      resumen: `Convenio ${mesLabel} · ${fichas.length} ficha${fichas.length === 1 ? '' : 's'}`,
      mesFacturado: mes,
      fichasJson: fichas.map(f => ({ id: f.id, codigo: f.codigo })),
      permitirFactura: true,
      dev: !!body.dev,
      creadoPorId: user?.id || '',
      creadoPorNombre: user?.name || '',
    })

    if (!r.ok) {
      resultados.push({ veterinaria_id: sel.veterinaria_id, nombre: vetProp.nombre, ok: false, error: r.error })
    } else {
      if (r.documento) {
        // eslint-disable-next-line no-await-in-loop
        await enviarCopiaFacturaOwner(r.documento, {
          vetNombre: vetProp.nombre,
          mesLabel,
          fichas: fichas.map(f => ({ codigo: f.codigo, nombre_mascota: f.nombre_mascota, monto: f.monto })),
        })
      }
      resultados.push({
        veterinaria_id: sel.veterinaria_id,
        nombre: vetProp.nombre,
        ok: true,
        folio: r.documento?.folio,
        documentoId: r.documento?.id,
        fichasFacturadas: fichas.length,
        monto: montoTotal,
      })
    }
  }

  return NextResponse.json({ resultados })
}
