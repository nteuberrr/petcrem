import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getConversacion, insertarMensaje, actualizarConversacion } from '@/lib/mensajes'
import { isWhatsappConfigured, enviarTextoWhatsapp } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'

/**
 * POST: agrega un mensaje saliente a la conversación.
 *
 * Si el canal es WhatsApp, está configurada la Cloud API y el contacto tiene
 * número (`wa_id`/`telefono`), se ENVÍA de verdad (texto libre, válido dentro de
 * la ventana de 24h). Si no, queda registrado como 'pendiente'.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const cuerpo = String(body.cuerpo ?? '').trim()
    if (!cuerpo) return NextResponse.json({ error: 'El mensaje está vacío' }, { status: 400 })

    const conv = await getConversacion(Number(id))
    if (!conv) return NextResponse.json({ error: 'Conversación no encontrada' }, { status: 404 })

    const session = await getServerSession(authOptions)
    const enviadoPor = (session?.user as { email?: string })?.email ?? null

    const destino = (conv.contacto?.wa_id || conv.contacto?.telefono || '').replace(/[^\d]/g, '')
    let estado = 'pendiente'
    let providerId: string | null = null
    let aviso: string | undefined

    if (conv.canal === 'whatsapp' && isWhatsappConfigured() && destino) {
      const res = await enviarTextoWhatsapp(destino, cuerpo)
      if (res.ok) { estado = 'enviado'; providerId = res.message_id ?? null }
      else {
        estado = 'fallido'
        aviso = res.fuera_de_ventana
          ? 'Fuera de la ventana de 24h: WhatsApp exige una plantilla aprobada para reabrir la conversación.'
          : `No se pudo enviar por WhatsApp: ${res.error}`
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
    return NextResponse.json({ ok: true, mensaje: msg, aviso })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
