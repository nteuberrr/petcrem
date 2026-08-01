import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { listarPorCliente, resolverProblemasEmail } from '@/lib/correos-log'
import { exigirNivel } from '@/lib/permisos-server'
import { getSheetData } from '@/lib/datastore'

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

/**
 * POST /api/clientes/[id]/correos  { accion: 'resolver' }
 *
 * Cierra los rebotes/fallos pendientes de la dirección que tiene HOY la ficha:
 * el equipo verificó con el tutor que sí recibe ahí (pasa cuando el proveedor
 * reporta un rebote genérico pero el correo igual llegó). Apaga la alerta del
 * campo email y el chip de "correos rebotados" en la lista de clientes, sin
 * borrar el registro — el estado original queda dentro de `motivo`.
 *
 * Afecta a toda ficha que use ese mismo correo: el rebote es del email.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await exigirNivel('clientes', 'editar')
  if (g.denegado) return g.denegado

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  if (body?.accion !== 'resolver') {
    return NextResponse.json({ error: 'Acción no soportada' }, { status: 400 })
  }

  const clientes = await getSheetData('clientes')
  const cliente = clientes.find(c => String(c.id) === String(id))
  if (!cliente) return NextResponse.json({ error: 'Ficha no encontrada' }, { status: 404 })

  const email = (cliente.email || '').trim()
  if (!email) return NextResponse.json({ error: 'La ficha no tiene correo' }, { status: 400 })

  const resueltos = await resolverProblemasEmail(email)
  return NextResponse.json({ ok: true, resueltos, email })
}
