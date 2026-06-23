import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { getSheetData, updateById } from '@/lib/datastore'

export const dynamic = 'force-dynamic'

const SHEET = 'eerr_proveedores'

async function noAutorizado(): Promise<boolean> {
  const s = await getServerSession(authOptions)
  return !esAdminTotal((s?.user as { role?: string })?.role)
}

export async function GET() {
  if (await noAutorizado()) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  try {
    const rows = await getSheetData(SHEET)
    rows.sort((a, b) => (a.razon_social || '').localeCompare(b.razon_social || ''))
    return NextResponse.json(rows)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

/**
 * Edita la contabilización automática de un proveedor. Cambiar/desactivar esto NO
 * toca lo ya registrado en las facturas, solo aplica a las que se carguen después.
 */
export async function PATCH(req: NextRequest) {
  if (await noAutorizado()) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  try {
    const b = await req.json()
    const { id, ids, ...updates } = b

    // Bulk: activar contabilización automática (mismo tipo + partida) en varios
    // proveedores a la vez, y aplicarla a sus facturas pendientes.
    if (Array.isArray(ids) && ids.length > 0) {
      const tipo = String(updates.auto_tipo || '')
      const partida = String(updates.auto_partida_id || '')
      if (!tipo || !partida) return NextResponse.json({ error: 'Elegí tipo y partida' }, { status: 400 })
      const rows = await getSheetData(SHEET)
      const byId = new Map(rows.map(r => [String(r.id), r]))
      const gastos = await getSheetData('eerr_gastos_sii')
      let aplicadas = 0
      for (const pid of ids) {
        const row = byId.get(String(pid))
        if (!row) continue
        await updateById(SHEET, row.id, { ...row, auto_contabiliza: 'TRUE', auto_tipo: tipo, auto_partida_id: partida })
        aplicadas++
        for (const g of gastos) {
          if (g.rut === row.rut && !g.partida_id) {
            await updateById('eerr_gastos_sii', g.id, { ...g, tipo_asignacion: tipo, partida_id: partida, contabilizado: 'TRUE' })
          }
        }
      }
      return NextResponse.json({ ok: true, aplicadas })
    }

    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    if ('auto_contabiliza' in updates) {
      updates.auto_contabiliza = updates.auto_contabiliza === true || updates.auto_contabiliza === 'TRUE' ? 'TRUE' : 'FALSE'
    }
    // Si se desactiva el auto, limpiamos el destino para que no quede colgado.
    if (updates.auto_contabiliza === 'FALSE') {
      updates.auto_tipo = ''
      updates.auto_partida_id = ''
    }
    const rows = await getSheetData(SHEET)
    const row = rows.find(r => String(r.id) === String(id))
    if (!row) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    const updated = { ...row, ...updates }
    await updateById(SHEET, String(id), updated)

    // Si quedó con contabilización automática y una partida, aplicarla a las
    // facturas PENDIENTES de ese proveedor. Las ya asignadas se dejan como están.
    if (updated.auto_contabiliza === 'TRUE' && updated.auto_partida_id) {
      const gastos = await getSheetData('eerr_gastos_sii')
      for (const g of gastos) {
        if (g.rut === updated.rut && !g.partida_id) {
          await updateById('eerr_gastos_sii', g.id, {
            ...g,
            tipo_asignacion: String(updated.auto_tipo || ''),
            partida_id: String(updated.auto_partida_id || ''),
            contabilizado: 'TRUE',
          })
        }
      }
    }

    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}
