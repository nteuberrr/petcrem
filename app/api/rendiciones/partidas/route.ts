import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdmin } from '@/lib/roles'
import { getSheetData } from '@/lib/datastore'

export const dynamic = 'force-dynamic'

/**
 * Lista de solo-lectura de las partidas ASIGNABLES (costo/gasto/impuesto, activas)
 * para el form de rendiciones. El módulo EERR es solo-admin, pero las rendiciones
 * las usa también admin2, que necesita elegir la partida de una boleta — por eso
 * este endpoint vive bajo /api/rendiciones (accesible a admin y admin2).
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!esAdmin((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }
  try {
    const [rows, subgrupos] = await Promise.all([getSheetData('eerr_partidas'), getSheetData('eerr_subgrupos')])
    const sgOrden = new Map(subgrupos.map(s => [s.id, parseInt(s.orden) || 0]))
    const SUELTA = 99999
    const partidas = rows
      .filter(r => r.tipo !== 'ingreso' && r.activo === 'TRUE')
      // Mismo orden que Parámetros: por tipo, luego subgrupo y orden de partida.
      .sort((a, b) =>
        a.tipo.localeCompare(b.tipo)
        || ((sgOrden.get(a.subgrupo_id || '') ?? SUELTA) - (sgOrden.get(b.subgrupo_id || '') ?? SUELTA))
        || ((parseInt(a.orden) || 0) - (parseInt(b.orden) || 0)))
      .map(r => ({ id: r.id, tipo: r.tipo, nombre: r.nombre, orden: r.orden }))
    return NextResponse.json(partidas)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
