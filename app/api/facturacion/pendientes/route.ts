import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { getSheetData } from '@/lib/datastore'

/**
 * GET /api/facturacion/pendientes
 * Fichas de TUTOR ya pagadas (estado_pago='pagado') que se quedaron sin boleta
 * automática (boleta_id vacío) — típicamente porque emitirBoletaFicha falló
 * (OpenFactura caído, receptor inválido, etc.). El aviso en el momento llega por
 * WhatsApp al admin; esta vista es para encontrarlas después y reintentar.
 * Solo admin-total.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!esAdminTotal((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }

  const rows = await getSheetData('clientes')
  const pendientes = rows
    .filter(c =>
      String(c.estado_pago || '').toLowerCase() === 'pagado' &&
      !String(c.veterinaria_id || '').trim() &&      // solo tutor (vets se facturan mensual/manual)
      String(c.estado || '') !== 'borrador' &&
      !!String(c.codigo || '').trim() &&
      !String(c.boleta_id || '').trim()
    )
    .map(c => ({
      id: c.id,
      codigo: c.codigo || '',
      nombre_mascota: c.nombre_mascota || '',
      nombre_tutor: c.nombre_tutor || '',
      email: c.email || '',
      precio_total: c.precio_total || '0',
      fecha_creacion: c.fecha_creacion || '',
    }))
    .sort((a, b) => (parseInt(b.id, 10) || 0) - (parseInt(a.id, 10) || 0))

  return NextResponse.json({ pendientes })
}
