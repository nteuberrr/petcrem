import { NextResponse } from 'next/server'
import { sinBoleta } from '@/lib/eerr-ingresos'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData } from '@/lib/datastore'
import { puedeNivel } from '@/lib/permisos-server'
import { vetsConBoletaAlCliente } from '@/lib/vet-boleta'

/**
 * GET /api/facturacion/pendientes
 * Fichas ya pagadas (estado_pago='pagado') que se quedaron sin boleta
 * automática (boleta_id vacío) — típicamente porque emitirBoletaFicha falló
 * (OpenFactura caído, receptor inválido, etc.). El aviso en el momento llega por
 * WhatsApp al admin; esta vista es para encontrarlas después y reintentar.
 * Solo admin-total.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!(await puedeNivel('facturacion', 'ver'))) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }

  const rows = await getSheetData('clientes')
  // Convenios con "Boleta al cliente": a esos no se les factura, se le boletea al
  // TUTOR igual que a una venta directa — así que sus fichas pagadas sin boleta SÍ
  // son un pendiente. Sin esto quedaban invisibles: ni acá ni en la propuesta
  // mensual del vet. Mismo driver que el emisor y que la propuesta (lib/vet-boleta).
  const boleteanAlTutor = await vetsConBoletaAlCliente()
  const pendientes = rows
    .filter(c =>
      String(c.estado_pago || '').toLowerCase() === 'pagado' &&
      // Tutor directo, o convenio que boletea al cliente (al resto se le factura mensual).
      (!String(c.veterinaria_id || '').trim() || boleteanAlTutor.has(String(c.veterinaria_id))) &&
      String(c.estado || '') !== 'borrador' &&
      !!String(c.codigo || '').trim() &&
      !String(c.boleta_id || '').trim() &&
      // Marcada "no emitir boleta" por el dueño: no es un pendiente, es una
      // decisión. Listarla acá invitaría a emitirla de todas formas.
      !sinBoleta(c)
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
