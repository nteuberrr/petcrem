import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { listarPorCliente } from '@/lib/correos-log'

/**
 * GET /api/clientes/[id]/correos
 *
 * Historial de correos transaccionales enviados al tutor de esta ficha
 * (registro / inicio cremación / inicio despacho / entrega / certificado) con
 * su estado reconciliado por el webhook de Resend. Alimenta el bloque "Correos
 * al tutor" de la ficha y la alerta de rebote del campo email.
 *
 * Accesible para cualquier sesión válida (operadores ven fichas).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const { id } = await params
  const correos = await listarPorCliente(id)
  return NextResponse.json({ correos })
}
