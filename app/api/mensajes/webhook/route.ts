import { NextRequest, NextResponse, after } from 'next/server'
import { verificarFirmaWebhook, descargarMedia, tipoInterno, enviarTextoWhatsapp, isWhatsappConfigured } from '@/lib/whatsapp'
import {
  upsertContacto, getOrCreateConversacion, insertarMensaje, getMensajes,
  actualizarConversacion, existeMensajePorProvider, marcarEstadoMensaje,
  type Conversacion, type Contacto,
} from '@/lib/mensajes'
import { isAgenteConfigurado, generarRespuesta } from '@/lib/agente-mensajes'
import { uploadToR2 } from '@/lib/cloudflare-r2'

export const dynamic = 'force-dynamic'

/**
 * Auto-respuesta del agente IA (corre en after(), tras devolver 200 a Meta).
 * Guardrails: kill-switch global (AGENTE_AUTO_RESPONDER), agente + WhatsApp
 * configurados, canal whatsapp, y la conversación no pausada (etiqueta 'pausado').
 */
async function autoResponder(conv: Conversacion, contacto: Contacto) {
  if (process.env.AGENTE_AUTO_RESPONDER === 'false') return
  if (!isAgenteConfigurado() || !isWhatsappConfigured()) return
  if (conv.canal !== 'whatsapp') return
  if ((conv.etiquetas || []).includes('pausado')) return
  const destino = (contacto.wa_id || contacto.telefono || '').replace(/\D/g, '')
  if (!destino) return

  const historial = (await getMensajes(conv.id))
    .filter(m => m.cuerpo)
    .map(m => ({ rol: (m.direccion === 'entrante' ? 'cliente' : 'nosotros') as 'cliente' | 'nosotros', texto: m.cuerpo as string }))
  if (historial.length === 0) return

  let r
  try { r = await generarRespuesta(historial) } catch (e) { console.error('[agente] generarRespuesta:', e); return }
  if (!r.mensaje) return

  const env = await enviarTextoWhatsapp(destino, r.mensaje)
  await insertarMensaje({
    conversacion_id: conv.id, direccion: 'saliente', cuerpo: r.mensaje,
    tipo: 'texto', estado: env.ok ? 'enviado' : 'fallido', enviado_por: 'agente',
  })
  if (r.escalar) {
    const tags = Array.from(new Set([...(conv.etiquetas || []), 'pausado', 'requiere-humano']))
    await actualizarConversacion(conv.id, { etiquetas: tags })
  }
}

/** Verificación del webhook (Meta hace un GET con hub.* al configurarlo). */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')
  if (mode === 'subscribe' && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? '', { status: 200 })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

const ESTADO_MAP: Record<string, string> = { sent: 'enviado', delivered: 'entregado', read: 'leido', failed: 'fallido' }
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
  'video/mp4': 'mp4', 'application/pdf': 'pdf',
}

interface MetaMsg {
  from: string; id: string; timestamp: string; type: string
  text?: { body: string }
  image?: { id: string; caption?: string; mime_type?: string }
  audio?: { id: string; mime_type?: string }
  voice?: { id: string; mime_type?: string }
  video?: { id: string; caption?: string; mime_type?: string }
  document?: { id: string; caption?: string; filename?: string; mime_type?: string }
  [k: string]: unknown
}

async function procesarEntrante(value: Record<string, unknown>, msg: MetaMsg) {
  if (await existeMensajePorProvider(msg.id)) return // dedupe

  const contacts = (value.contacts as Array<{ wa_id?: string; profile?: { name?: string } }>) ?? []
  const nombre = contacts.find(c => c.wa_id === msg.from)?.profile?.name || contacts[0]?.profile?.name || null

  const contacto = await upsertContacto({ wa_id: msg.from, telefono: msg.from, nombre, audiencia: 'A' })
  const conv = await getOrCreateConversacion(contacto.id, 'whatsapp', contacto.audiencia, 'whatsapp')
  if (conv.estado === 'cerrada') await actualizarConversacion(conv.id, { estado: 'abierta' })

  const tipo = tipoInterno(msg.type)
  let cuerpo: string | null = null
  let mediaUrl: string | null = null
  const mediaObj = (msg.image || msg.audio || msg.voice || msg.video || msg.document) as { id?: string; caption?: string } | undefined

  if (msg.type === 'text') {
    cuerpo = msg.text?.body ?? ''
  } else if (mediaObj?.id) {
    cuerpo = mediaObj.caption ?? null
    try {
      const media = await descargarMedia(mediaObj.id)
      if (media) {
        const ext = EXT[media.mime] || 'bin'
        const r = await uploadToR2(media.buffer, `mensajes/media/${mediaObj.id}.${ext}`, media.mime)
        mediaUrl = r.url
      }
    } catch (e) { console.warn('[webhook] media falló', e) }
  } else {
    // location, contacts, interactive, button, reaction, etc.: guardamos un resumen.
    cuerpo = `[${tipo}]`
  }

  await insertarMensaje({
    conversacion_id: conv.id,
    direccion: 'entrante',
    cuerpo,
    tipo,
    media_url: mediaUrl,
    provider_message_id: msg.id,
    ts: new Date(Number(msg.timestamp) * 1000 || Date.now()).toISOString(),
  })

  // Auto-respuesta del agente solo para mensajes de texto, tras responder a Meta.
  if (msg.type === 'text' && cuerpo) {
    after(() => autoResponder(conv, contacto).catch(e => console.error('[agente] autoResponder:', e)))
  }
}

/** Recepción de eventos (mensajes entrantes + cambios de estado). */
export async function POST(req: NextRequest) {
  const raw = await req.text()
  const sig = req.headers.get('x-hub-signature-256')
  if (!verificarFirmaWebhook(raw, sig)) {
    return NextResponse.json({ error: 'firma inválida' }, { status: 401 })
  }
  let body: { entry?: Array<{ changes?: Array<{ value?: Record<string, unknown> }> }> }
  try { body = JSON.parse(raw) } catch { return NextResponse.json({ ok: true }) }

  try {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {}
        for (const st of (value.statuses as Array<{ id?: string; status?: string }>) ?? []) {
          if (st.id && st.status && ESTADO_MAP[st.status]) await marcarEstadoMensaje(st.id, ESTADO_MAP[st.status])
        }
        for (const msg of (value.messages as MetaMsg[]) ?? []) {
          await procesarEntrante(value, msg)
        }
      }
    }
  } catch (e) {
    console.error('[whatsapp webhook] error procesando:', e)
  }
  // Siempre 200 para que Meta no reintente en loop.
  return NextResponse.json({ ok: true })
}
