import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { z } from 'zod'
import { appendRow, getNextId } from '@/lib/datastore'
import { resolverSolicitudRetiro } from '@/lib/solicitudes-retiro'
import { capitalizarNombre } from '@/lib/nombres'

/**
 * POST /api/clientes/agendamiento-manual
 *
 * Registra a mano un agendamiento de retiro (equivalente a cuando el bot registra
 * un retiro y el admin lo confirma): crea la ficha BORRADOR "Por ingresar" y le manda
 * al tutor la CONFIRMACIÓN por WhatsApp. Corre en el servidor (producción), así que el
 * link firmado de la confirmación SIEMPRE queda válido (nada de links firmados en local
 * que prod rechaza). Requiere sesión (acceso de la sección Clientes).
 */
const Schema = z.object({
  cliente_nombre: z.string().min(1, 'Nombre del tutor requerido'),
  telefono: z.string().min(8, 'WhatsApp requerido'),
  nombre_mascota: z.string().min(1, 'Nombre de la mascota requerido'),
  direccion: z.string().min(1, 'Dirección requerida'),
  comuna: z.string().min(1, 'Comuna requerida'),
  codigo_servicio: z.enum(['CI', 'CP', 'SD']),
  fecha_retiro: z.string().min(1, 'Fecha de retiro requerida'),
  hora_retiro: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM)'),
  peso: z.union([z.string(), z.number()]).optional(),
})

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  try {
    const d = Schema.parse(await req.json())
    const tel = d.telefono.replace(/\D/g, '')
    if (tel.length < 8) return NextResponse.json({ error: 'El WhatsApp no es válido.' }, { status: 400 })
    // Guardamos con código país (56) para que la confirmación por WhatsApp salga bien.
    const wa = tel.length === 9 ? `56${tel}` : tel

    const id = await getNextId('solicitudes_retiro')
    await appendRow('solicitudes_retiro', {
      id,
      cliente_wa_id: wa,
      cliente_nombre: capitalizarNombre(d.cliente_nombre),
      nombre_mascota: capitalizarNombre(d.nombre_mascota),
      peso: d.peso != null && d.peso !== '' ? String(d.peso) : '',
      direccion: d.direccion,
      comuna: d.comuna,
      fecha_retiro: d.fecha_retiro,
      hora_retiro: d.hora_retiro,
      tipo_servicio: d.codigo_servicio,
      estado: 'pendiente',
      origen: 'manual',
      fecha_creacion: new Date().toISOString(),
    })

    // Mismo flujo que el botón "Confirmar" del panel: crea el borrador y manda la
    // confirmación por WhatsApp al tutor (con el link válido firmado en prod).
    const r = await resolverSolicitudRetiro(String(id), true)
    return NextResponse.json({ ok: true, solicitud_id: id, ...r })
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.issues[0]?.message || 'Datos inválidos.' }, { status: 400 })
    }
    console.error('[agendamiento-manual]', e)
    return NextResponse.json({ error: 'No se pudo registrar el agendamiento.' }, { status: 500 })
  }
}
