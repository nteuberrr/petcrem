import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { getSheetData } from '@/lib/datastore'

/**
 * GET /api/facturacion/documentos?tipo=39|33|61&desde&hasta&q&orden=fecha|monto&dir=asc|desc
 * Lista documentos tributarios emitidos, con filtros. Solo admin-total.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!esAdminTotal((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }

  const sp = req.nextUrl.searchParams
  const tipo = sp.get('tipo') || ''
  const desde = sp.get('desde') || ''
  const hasta = sp.get('hasta') || ''
  const q = (sp.get('q') || '').trim().toLowerCase()
  const orden = sp.get('orden') || 'fecha'
  const dir = sp.get('dir') === 'asc' ? 1 : -1

  const rows = await getSheetData('documentos_tributarios')

  let filtrados = rows.filter(r => {
    if (tipo && r.tipo_dte !== tipo) return false
    if (desde && r.fecha_emision < desde) return false
    if (hasta && r.fecha_emision > hasta) return false
    if (q) {
      const hay = `${r.folio} ${r.receptor_razon_social} ${r.receptor_rut} ${r.resumen} ${r.mes_facturado}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  filtrados = filtrados.sort((a, b) => {
    if (orden === 'monto') return dir * (parseFloat(a.monto_total || '0') - parseFloat(b.monto_total || '0'))
    if (orden === 'folio') return dir * (parseInt(a.folio || '0', 10) - parseInt(b.folio || '0', 10))
    // default: fecha_emision, desempate por id
    const cmp = a.fecha_emision.localeCompare(b.fecha_emision) || (parseInt(a.id, 10) - parseInt(b.id, 10))
    return dir * cmp
  })

  return NextResponse.json({ documentos: filtrados })
}
