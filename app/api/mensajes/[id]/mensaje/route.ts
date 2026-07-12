import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getConversacion, insertarMensaje, actualizarConversacion } from '@/lib/mensajes'
import { isWhatsappConfigured, enviarTextoWhatsapp, enviarPlantillaWhatsapp, renderPlantillaWa, plantillasAprobadas } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'

const PLANTILLA_REAPERTURA = 'retomar_conversacion'

/**
 * POST: agrega un mensaje saliente a la conversación.
 *
 * Si el canal es WhatsApp, está configurada la Cloud API y el contacto tiene
 * número (`wa_id`/`telefono`), se ENVÍA de verdad (texto libre, válido dentro de
 * la ventana de 24h). Si no, queda registrado como 'pendiente'.
 *
 * Con `{ plantilla: true }` envía la plantilla aprobada de REAPERTURA
 * (retomar_conversacion) en vez de texto libre — es lo único que WhatsApp
 * permite con la ventana de 24h cerrada (tiene costo por mensaje). El texto
 * registrado en el inbox es el que la persona recibió de verdad.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const usarPlantilla = body.plantilla === true
    let cuerpo = String(body.cuerpo ?? '').trim()
    if (!cuerpo && !usarPlantilla) return NextResponse.json({ error: 'El mensaje está vacío' }, { status: 400 })

    const conv = await getConversacion(Number(id))
    if (!conv) return NextResponse.json({ error: 'Conversación no encontrada' }, { status: 404 })

    const session = await getServerSession(authOptions)
    const enviadoPor = (session?.user as { email?: string })?.email ?? null

    const destino = (conv.contacto?.wa_id || conv.contacto?.telefono || '').replace(/[^\d]/g, '')
    let estado = 'pendiente'
    let providerId: string | null = null
    let aviso: string | undefined
    let plantillaDisponible = false

    if (usarPlantilla) {
      if (conv.canal !== 'whatsapp' || !isWhatsappConfigured() || !destino) {
        return NextResponse.json({ error: 'La plantilla solo aplica a conversaciones de WhatsApp con número.' }, { status: 400 })
      }
      if (!(await plantillasAprobadas()).has(PLANTILLA_REAPERTURA)) {
        return NextResponse.json({ error: 'La plantilla de reapertura aún no está aprobada por Meta.' }, { status: 400 })
      }
      const nombre = (conv.contacto?.nombre || '').trim().split(/\s+/)[0] || '👋'
      const res = await enviarPlantillaWhatsapp(destino, PLANTILLA_REAPERTURA, [nombre])
      if (!res.ok) return NextResponse.json({ error: `No se pudo enviar la plantilla: ${res.error}` }, { status: 502 })
      estado = 'enviado'
      providerId = res.message_id ?? null
      cuerpo = renderPlantillaWa(PLANTILLA_REAPERTURA, [nombre])
    } else if (conv.canal === 'whatsapp' && isWhatsappConfigured() && destino) {
      const res = await enviarTextoWhatsapp(destino, cuerpo)
      if (res.ok) { estado = 'enviado'; providerId = res.message_id ?? null }
      else {
        estado = 'fallido'
        if (res.fuera_de_ventana) {
          plantillaDisponible = (await plantillasAprobadas()).has(PLANTILLA_REAPERTURA)
          aviso = 'Fuera de la ventana de 24h: WhatsApp exige una plantilla aprobada para reabrir la conversación.'
        } else {
          aviso = `No se pudo enviar por WhatsApp: ${res.error}`
        }
      }
    } else if (!isWhatsappConfigured()) {
      aviso = 'WhatsApp aún no está conectado: el mensaje quedó registrado pero no se envió.'
    } else if (!destino) {
      aviso = 'Este contacto no tiene número de WhatsApp (conversación histórica): el mensaje quedó registrado.'
    }

    const msg = await insertarMensaje({
      conversacion_id: conv.id,
      direccion: 'saliente',
      cuerpo,
      tipo: 'texto',
      estado,
      provider_message_id: providerId,
      enviado_por: enviadoPor,
    })
    // Un humano respondió manualmente → pausa el agente IA en esta conversación.
    if (!(conv.etiquetas || []).includes('pausado')) {
      await actualizarConversacion(conv.id, { etiquetas: [...(conv.etiquetas || []), 'pausado'] })
    }
    return NextResponse.json({ ok: true, mensaje: msg, aviso, plantilla_disponible: plantillaDisponible || undefined })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
