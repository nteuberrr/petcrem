import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData } from '@/lib/datastore'
import { sendEmail, isResendConfigured } from '@/lib/resend-mailer'
import { getContacto } from '@/lib/email-layout'
import { buildRegistro, resumenCompraDeFicha } from '@/lib/cliente-mailer'
import { registrarEnvio } from '@/lib/correos-log'

/**
 * POST /api/clientes/[id]/reenviar-registro
 *
 * Reenvía al tutor el correo de ingreso (bienvenida + código + resumen) de esta
 * ficha, REGENERÁNDOLO con datos en vivo: los botones "subir foto" / "solicitar
 * video" / "foto del cuadro" son links firmados que vencen a las 48 h, así que
 * el reenvío los emite de nuevo y el tutor vuelve a tener 48 h. Va al correo
 * que hoy tiene la ficha (mismo camino que el envío original: se registra en
 * correos_cliente y en correos_log, y respeta el BCC de seguimiento).
 *
 * Accesible para cualquier sesión válida (operadores gestionan fichas).
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  if (!isResendConfigured()) {
    return NextResponse.json({ error: 'El envío de correos no está configurado (falta RESEND_API_KEY).' }, { status: 400 })
  }

  const { id } = await params
  const cliente = (await getSheetData('clientes')).find(c => String(c.id) === String(id))
  if (!cliente) return NextResponse.json({ error: 'Ficha no encontrada' }, { status: 404 })

  const email = String(cliente.email || '').trim()
  if (!email) return NextResponse.json({ error: 'La ficha no tiene correo registrado.' }, { status: 400 })
  if (!String(cliente.codigo || '').trim()) {
    return NextResponse.json({ error: 'La ficha aún no está registrada (no tiene código).' }, { status: 400 })
  }

  const contacto = await getContacto()
  const opts = buildRegistro({
    email,
    nombreMascota: String(cliente.nombre_mascota || ''),
    nombreTutor: String(cliente.nombre_tutor || ''),
    codigo: String(cliente.codigo || ''),
    clienteId: String(cliente.id),
    codigoServicio: String(cliente.codigo_servicio || ''),
    resumen: (await resumenCompraDeFicha(cliente).catch(() => null)) ?? undefined,
  }, contacto)

  const res = await sendEmail(opts)
  await registrarEnvio({
    clienteId: String(cliente.id),
    tipo: 'registro',
    email,
    messageId: res.message_id,
    ok: res.ok,
    error: res.error,
  })
  if (!res.ok) return NextResponse.json({ error: res.error || 'No se pudo enviar el correo.' }, { status: 502 })
  return NextResponse.json({ ok: true, to: email, message_id: res.message_id })
}
