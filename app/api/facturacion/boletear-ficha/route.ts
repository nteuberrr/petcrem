import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, updateByIdIf } from '@/lib/datastore'
import { emitirBoletaFicha } from '@/lib/facturacion'
import { calcularPrecioFicha, type Tramo } from '@/lib/ficha-precio'
import { devengarComisionDeFicha } from '@/lib/comisiones'
import { puedeNivel } from '@/lib/permisos-server'

/**
 * POST /api/facturacion/boletear-ficha  { fichaId, dev? }
 *
 * Emite la BOLETA (39) al TUTOR de una ficha DE CONVENIO y se la manda a su correo
 * (no al del veterinario). Es el caso de los vets con comisión: en vez de facturarle
 * el servicio al vet, le cobramos el precio completo al tutor y al vet le queda la
 * comisión devengada (lib/comisiones.ts).
 *
 * Excluyente con la factura al vet: una ficha lleva boleta O factura, nunca las dos.
 * Al quedar con `boleta_id`, sale de la propuesta mensual (lib/facturacion-vets.ts).
 * Solo admin-total.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const user = session?.user as { role?: string; id?: string; name?: string } | undefined
  if (!(await puedeNivel('facturacion', 'editar'))) {
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
  if (String(c.estado || '') === 'borrador' || !String(c.codigo || '').trim()) {
    return NextResponse.json({ error: 'La ficha no está registrada todavía.' }, { status: 400 })
  }
  if (String(c.boleta_id || '').trim()) {
    return NextResponse.json({ error: 'Esta ficha ya tiene boleta.' }, { status: 409 })
  }
  if (String(c.factura_vet_id || '').trim()) {
    return NextResponse.json({ error: 'Esta ficha ya fue facturada al veterinario. Anula la factura antes de boletearla.' }, { status: 409 })
  }
  if (!String(c.email || '').trim()) {
    return NextResponse.json({ error: 'La ficha no tiene correo del tutor: la boleta no tendría a quién enviarse.' }, { status: 400 })
  }

  // Monto: snapshot congelado o cálculo en vivo (fichas legacy sin snapshot). Es el
  // mismo criterio que la factura al vet, así el documento nunca sale en $0.
  const vetId = String(c.veterinaria_id || '').trim()
  const vet = vets.find(v => String(v.id) === vetId)
  const especialesDeVet = (preciosE as unknown as Tramo[]).filter(t => t.veterinaria_id === vetId)
  const precio = calcularPrecioFicha(c, vet?.tipo_precios, {
    generales: preciosG as unknown as Tramo[],
    convenio: preciosC as unknown as Tramo[],
    especialesDeVet,
  })
  if (precio.total <= 0) {
    return NextResponse.json({ error: 'La ficha no tiene monto para boletear.' }, { status: 400 })
  }

  const r = await emitirBoletaFicha(
    { ...c, precio_total: String(precio.total) },
    { creadoPorId: user?.id || '', creadoPorNombre: user?.name || '' },
  )
  if (!r.ok || !r.documento) {
    return NextResponse.json({ error: r.error || 'No se pudo emitir la boleta.' }, { status: 502 })
  }

  await updateByIdIf('clientes', String(c.id), {}, { boleta_id: String(r.documento.id) })

  // Comisión del veterinario que derivó (si tiene regla activa). Misma función que
  // usa la emisión automática — el devengo tiene que ser idéntico venga por donde
  // venga. Best-effort: la boleta ya está emitida ante el SII y no se revierte
  // porque falle el devengo. Si la ficha ya la había devengado al quedar pagada,
  // esto solo completa la referencia al documento.
  let comision = 0
  if (vetId) {
    try {
      const d = await devengarComisionDeFicha(c, { documento_id: String(r.documento.id) })
      comision = d.monto ?? 0
    } catch (e) {
      console.warn('[boletear-ficha] no se pudo devengar la comisión (no bloqueante):', e)
    }
  }

  return NextResponse.json({
    ok: true,
    folio: r.documento.folio,
    documentoId: r.documento.id,
    monto: precio.total,
    comision,
  })
}
