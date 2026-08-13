import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { z } from 'zod'
import { appendRow, getNextId } from '@/lib/datastore'
import { resolverSolicitudRetiro } from '@/lib/solicitudes-retiro'
import { evaluarSlotRetiro } from '@/lib/agenda'
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
  /** Se ignora: quedó de cuando el choque de horario bloqueaba el guardado. */
  forzar: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  try {
    const d = Schema.parse(await req.json())
    // El número se valida ENTERO, no "que tenga al menos 8 dígitos". Un móvil
    // chileno son 9 dígitos empezando en 9 (o 11 con el 56 adelante). Con la
    // regla vieja, un número al que le faltaba un dígito se guardaba igual y la
    // confirmación se mandaba al vacío: Meta responde 200 y no entrega, así que
    // el equipo daba por avisado a un tutor que nunca supo nada (caso real
    // 11-08-2026, solicitud #114). Adivinar el dígito que falta no es opción
    // —se le escribiría a un desconocido—, así que se rechaza y se corrige.
    const tel = d.telefono.replace(/\D/g, '')
    const wa = tel.length === 9 && tel.startsWith('9') ? `56${tel}`
      : tel.length === 11 && tel.startsWith('569') ? tel
      : ''
    if (!wa) {
      return NextResponse.json(
        { error: `El WhatsApp «${d.telefono}» no es un móvil chileno válido: son 9 dígitos empezando en 9 (por ejemplo 961217925).` },
        { status: 400 },
      )
    }

    // El horario se EVALÚA pero NO se bloquea (decisión del dueño 2026-08-12).
    // Lo que el bot no puede hacer solo, el equipo sí: una familia que necesita
    // el retiro a esa hora vale más que la separación de 30/45 minutos, y quien
    // agenda a mano está mirando la ruta. El sistema informa y agenda igual; la
    // superposición queda visible en morado en la agenda (lib/agenda →
    // `superpuesto`), que es donde sirve. Antes esto devolvía 409 y obligaba a
    // guardar dos veces.
    let aviso: string | null = null
    try {
      const slot = await evaluarSlotRetiro(d.fecha_retiro, d.hora_retiro)
      if (!slot.ok) aviso = slot.motivo || 'Ese horario choca con otra reserva.'
    } catch (e) { console.warn('[agendamiento-manual] no se pudo evaluar el horario:', e) }

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
    return NextResponse.json({ ok: true, solicitud_id: id, aviso, ...r })
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.issues[0]?.message || 'Datos inválidos.' }, { status: 400 })
    }
    console.error('[agendamiento-manual]', e)
    return NextResponse.json({ error: 'No se pudo registrar el agendamiento.' }, { status: 500 })
  }
}
