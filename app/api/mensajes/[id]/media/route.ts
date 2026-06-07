import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getConversacion, insertarMensaje, actualizarConversacion } from '@/lib/mensajes'
import { isWhatsappConfigured, enviarMediaWhatsapp, waMediaDeMime } from '@/lib/whatsapp'
import { uploadToR2 } from '@/lib/cloudflare-r2'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Tope de subida a través del servidor (Vercel limita el body a ~4.5 MB).
const MAX_BYTES = Math.floor(4.4 * 1024 * 1024)

function slug(name: string): string {
  return (name || 'archivo').normalize('NFKD').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').slice(-80) || 'archivo'
}

/**
 * POST (multipart): adjunta un archivo (foto/video/documento/pdf…) a la
 * conversación. Sube a R2 y, si el canal es WhatsApp y está configurado, lo
 * envía por `link`. Un humano adjuntando pausa el agente en esa conversación.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const conv = await getConversacion(Number(id))
    if (!conv) return NextResponse.json({ error: 'Conversación no encontrada' }, { status: 404 })

    const form = await req.formData()
    const file = form.get('file')
    const caption = String(form.get('caption') ?? '').trim()
    if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'No se recibió ningún archivo' }, { status: 400 })
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'El archivo supera ~4 MB (límite de subida). Comprímelo o usa uno más liviano.' }, { status: 413 })

    const mime = file.type || 'application/octet-stream'
    const { tipo, tipoInterno } = waMediaDeMime(mime)
    const buffer = Buffer.from(await file.arrayBuffer())
    const key = `mensajes/media/out/${id}-${Date.now()}-${slug(file.name)}`
    const { url } = await uploadToR2(buffer, key, mime)

    const session = await getServerSession(authOptions)
    const enviadoPor = (session?.user as { email?: string })?.email ?? null
    const destino = (conv.contacto?.wa_id || conv.contacto?.telefono || '').replace(/[^\d]/g, '')

    let estado = 'pendiente'
    let providerId: string | null = null
    let aviso: string | undefined

    if (conv.canal === 'whatsapp' && isWhatsappConfigured() && destino) {
      const res = await enviarMediaWhatsapp(destino, { tipo, link: url, caption: caption || undefined, filename: file.name })
      if (res.ok) { estado = 'enviado'; providerId = res.message_id ?? null }
      else {
        estado = 'fallido'
        aviso = res.fuera_de_ventana
          ? 'Fuera de la ventana de 24h: WhatsApp exige una plantilla aprobada para reabrir la conversación.'
          : `No se pudo enviar por WhatsApp: ${res.error}`
      }
    } else if (!isWhatsappConfigured()) {
      aviso = 'WhatsApp aún no está conectado: el archivo quedó registrado pero no se envió.'
    } else if (!destino) {
      aviso = 'Este contacto no tiene número de WhatsApp: el archivo quedó registrado.'
    }

    const msg = await insertarMensaje({
      conversacion_id: conv.id, direccion: 'saliente',
      cuerpo: caption || null, tipo: tipoInterno, media_url: url,
      estado, provider_message_id: providerId, enviado_por: enviadoPor,
    })
    // Un humano adjuntó → pausa el agente IA en esta conversación.
    if (!(conv.etiquetas || []).includes('pausado')) {
      await actualizarConversacion(conv.id, { etiquetas: [...(conv.etiquetas || []), 'pausado'] })
    }
    return NextResponse.json({ ok: true, mensaje: msg, aviso })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
