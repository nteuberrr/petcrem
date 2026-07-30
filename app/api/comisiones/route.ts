import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import {
  resumenComisiones, detalleVet, guardarRegla, eliminarRegla, ajustarSaldo,
  type TipoComision,
} from '@/lib/comisiones'

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
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const user = session?.user as { role?: string; id?: string; name?: string } | undefined
  if (!esAdminTotal(user?.role)) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  try {
    const b = await req.json()
    const accion = String(b.accion || 'regla')

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

/** DELETE ?id= — quita la regla. Los devengos ya generados se conservan. */
export async function DELETE(req: NextRequest) {
  if (await noAutorizado()) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  try {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    await eliminarRegla(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
