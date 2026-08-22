import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import {
  resumenComisiones, detalleVet, guardarRegla, eliminarRegla, ajustarSaldo,
  editarAjuste, eliminarAjuste,
  type TipoComision,
} from '@/lib/comisiones'
import { activarIndexado, desactivarIndexado } from '@/lib/precios-indexados'

export const dynamic = 'force-dynamic'

/**
 * Comisiones de convenio — Configuración → Descuentos Convenios.
 *
 * SOLO EL DUEÑO (admin-total). Aunque la pestaña vive en Configuración (que admin2
 * sí ve), esto define plata que se paga y registra COSTO DE VENTA en el EERR, así
 * que se gatea igual que Facturación. No agregar esta ruta al módulo 'configuracion'
 * de lib/permisos.ts.
 */
async function noAutorizado(): Promise<boolean> {
  const s = await getServerSession(authOptions)
  return !esAdminTotal((s?.user as { role?: string })?.role)
}

/** GET → resumen de saldos. `?veterinaria_id=` → detalle (devengos + ajustes) de esa vet. */
export async function GET(req: NextRequest) {
  if (await noAutorizado()) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  try {
    const vetId = new URL(req.url).searchParams.get('veterinaria_id')
    if (vetId) return NextResponse.json(await detalleVet(vetId))
    return NextResponse.json(await resumenComisiones())
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

/**
 * POST — dos acciones:
 *   { accion: 'regla',  veterinaria_id, tipo, valor, activo? }  → alta/edición de la regla
 *   { accion: 'ajuste', veterinaria_id, monto, detalle?, fecha? } → paga saldo → costo de venta
 *   { accion: 'indexar' | 'desindexar', veterinaria_id }          → tarifa = precios generales
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const user = session?.user as { role?: string; id?: string; name?: string } | undefined
  if (!esAdminTotal(user?.role)) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  try {
    const b = await req.json()
    const accion = String(b.accion || 'regla')

    // Indexar: la tarifa del vet pasa a seguir a los PRECIOS GENERALES (se copian a
    // sus tramos especiales y se re-sincronizan solas cada vez que cambian los generales).
    if (accion === 'indexar' || accion === 'desindexar') {
      const vid = String(b.veterinaria_id || '')
      if (!vid) return NextResponse.json({ error: 'Falta la veterinaria.' }, { status: 400 })
      if (accion === 'indexar') {
        // Vet de comisión: al tutor se le cobra el precio de lista → GENERAL.
        const r = await activarIndexado(vid, 'general')
        return NextResponse.json({ ok: true, indexado: true, tramos: r.tramos })
      }
      await desactivarIndexado(vid)
      return NextResponse.json({ ok: true, indexado: false })
    }

    if (accion === 'ajuste') {
      const ajuste = await ajustarSaldo({
        veterinaria_id: String(b.veterinaria_id || ''),
        monto: Number(b.monto),
        detalle: b.detalle ? String(b.detalle) : '',
        fecha: b.fecha ? String(b.fecha) : undefined,
        creado_por_id: user?.id || '',
        creado_por_nombre: user?.name || '',
      })
      return NextResponse.json(ajuste, { status: 201 })
    }

    const regla = await guardarRegla({
      veterinaria_id: String(b.veterinaria_id || ''),
      tipo: String(b.tipo || 'fijo') as TipoComision,
      valor: Number(b.valor),
      activo: b.activo !== false,
    })
    return NextResponse.json(regla, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 })
  }
}

/**
 * PATCH { accion: 'ajuste', id, monto, detalle?, fecha? } — corrige un pago ya
 * registrado. Mueve TAMBIÉN su gasto en el EERR (ver `editarAjuste`): editar solo
 * el saldo dejaría el Estado de Resultados con otro número.
 *
 * La veterinaria no se cambia: para eso se borra y se carga de nuevo.
 */
export async function PATCH(req: NextRequest) {
  if (await noAutorizado()) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  try {
    const b = await req.json()
    if (String(b.accion || '') !== 'ajuste') {
      return NextResponse.json({ error: 'Acción no soportada.' }, { status: 400 })
    }
    const ajuste = await editarAjuste(String(b.id || ''), {
      monto: Number(b.monto),
      detalle: b.detalle === undefined ? undefined : String(b.detalle),
      fecha: b.fecha ? String(b.fecha) : undefined,
    })
    return NextResponse.json(ajuste)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 })
  }
}

/**
 * DELETE ?id=       — quita la REGLA (los devengos ya generados se conservan).
 * DELETE ?ajuste_id= — borra un PAGO y su gasto en el EERR.
 *
 * Son dos parámetros distintos a propósito: un `id` ambiguo entre regla y ajuste
 * es una forma cómoda de borrar la cosa equivocada.
 */
export async function DELETE(req: NextRequest) {
  if (await noAutorizado()) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  try {
    const q = new URL(req.url).searchParams
    const ajusteId = q.get('ajuste_id')
    if (ajusteId) {
      await eliminarAjuste(ajusteId)
      return NextResponse.json({ ok: true })
    }
    const id = q.get('id')
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    await eliminarRegla(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
