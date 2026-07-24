import crypto from 'node:crypto'
import { NextRequest, NextResponse, after } from 'next/server'
import { verificarFirmaWebhook, descargarMedia, tipoInterno, enviarTextoWhatsapp, enviarMediaWhatsapp, isWhatsappConfigured, esDestinatarioAvisos, esDestinatarioRetiros, avisarAdminsWhatsapp, avisarEquipoRetiros } from '@/lib/whatsapp'
import {
  upsertContacto, getOrCreateConversacion, insertarMensaje, getMensajes,
  actualizarConversacion, existeMensajePorProvider, marcarEstadoMensaje, getConversacion,
  normalizarEstado, type Conversacion, type Contacto,
} from '@/lib/mensajes'
import { esTelefonoVet } from '@/lib/vet-lookup'
import { isInstagramMensajesConfigurado, enviarTextoInstagram, enviarImagenInstagram, perfilInstagram } from '@/lib/instagram'
import { isAgenteConfigurado, generarRespuesta, redactarRelayCliente } from '@/lib/agente-mensajes'
import { handlersAgente } from '@/lib/agente-acciones'
import { buscarRelayPendientePorMsg, buscarRelayPendienteUnico, marcarRelayRespondida } from '@/lib/relay-retiro'
import { resolverSolicitudRetiro } from '@/lib/solicitudes-retiro'
import { uploadToR2 } from '@/lib/cloudflare-r2'

export const dynamic = 'force-dynamic'
// Cubre el debounce anti-ráfaga (abajo) + la generación del agente en after().
export const maxDuration = 60

/** Debounce anti-ráfaga: al llegar un mensaje esperamos un poco; si el cliente
 *  manda más mensajes seguidos, solo el ÚLTIMO responde (con todo el contexto),
 *  evitando varias respuestas a una tanda de preguntas. Ver autoResponder. */
const DEBOUNCE_MS = 5000

/**
 * Auto-respuesta del agente IA (corre en after(), tras devolver 200 a Meta).
 * Guardrails: kill-switch global (AGENTE_AUTO_RESPONDER), agente + canal
 * configurados, y la conversación no pausada (etiqueta 'pausado').
 * Canales: whatsapp (flujo completo, con tools de agendamiento) e instagram
 * (informa/cotiza/escala; sin tools de agendamiento — esos corren por WhatsApp).
 */
async function autoResponder(conv: Conversacion, contacto: Contacto) {
  if (process.env.AGENTE_AUTO_RESPONDER === 'false') return
  if (!isAgenteConfigurado()) return
  const esIg = conv.canal === 'instagram'
  if (conv.canal !== 'whatsapp' && !esIg) return
  if (esIg ? !isInstagramMensajesConfigurado() : !isWhatsappConfigured()) return
  if ((conv.etiquetas || []).includes('pausado')) return
  const destino = esIg
    ? (contacto.instagram || '')
    : (contacto.wa_id || contacto.telefono || '').replace(/\D/g, '')
  if (!destino) return

  // ── Debounce anti-ráfaga ──────────────────────────────────────────────────
  // El cliente suele mandar varias preguntas en mensajes separados y seguidos;
  // cada uno dispara este webhook. Sin esto, el bot respondía UNA VEZ POR
  // MENSAJE. Solución: marcamos el ts del último mensaje ENTRANTE, esperamos
  // DEBOUNCE_MS y volvemos a mirar. Si en ese lapso llegó otro mensaje entrante
  // MÁS NUEVO, este turno se abandona (lo responderá el webhook de ese mensaje,
  // ya con el contexto completo). Así una tanda de preguntas → UNA respuesta.
  const tsUltimoEntrante = (msgs: Awaited<ReturnType<typeof getMensajes>>) =>
    msgs.filter(m => m.direccion === 'entrante').reduce((mx, m) => Math.max(mx, new Date(m.ts as string).getTime() || 0), 0)
  const t0 = tsUltimoEntrante(await getMensajes(conv.id))
  await new Promise(r => setTimeout(r, DEBOUNCE_MS))
  const msgsFrescos = await getMensajes(conv.id)
  if (tsUltimoEntrante(msgsFrescos) > t0) {
    console.log('[agente] llegó otro mensaje durante el debounce — este turno se salta:', conv.id)
    return
  }

  const historial = msgsFrescos
    .filter(m => m.cuerpo)
    .map(m => ({ rol: (m.direccion === 'entrante' ? 'cliente' : 'nosotros') as 'cliente' | 'nosotros', texto: m.cuerpo as string }))
  if (historial.length === 0) return

  let r
  try {
    r = await generarRespuesta(historial, {
      // En Instagram no se inyectan las tools de agendamiento (retiro/eutanasia
      // corren por WhatsApp con botones al admin + links firmados): el agente
      // informa, cotiza, pide el WhatsApp y escala. escalar_a_humano va siempre.
      handlers: esIg ? undefined : handlersAgente(),
      ctx: esIg
        ? { nombreContacto: contacto.nombre ?? undefined, canal: 'instagram' }
        : { waId: destino, nombreContacto: contacto.nombre ?? undefined },
    })
  } catch (e) { console.error('[agente] generarRespuesta:', e); return }
  if (!r.mensaje && !(r.imagenes && r.imagenes.length)) return

  // Re-leer la conversación JUSTO antes de enviar: generarRespuesta puede tardar
  // varios segundos y en ese lapso un humano pudo tomar la conversación desde el
  // inbox (que la marca 'pausado'). Si quedó pausada, no enviamos — manda el humano.
  try {
    const fresca = await getConversacion(conv.id)
    if (fresca && (fresca.etiquetas || []).includes('pausado')) {
      console.log('[agente] conversación pausada durante la generación — no envío:', conv.id)
      return
    }
  } catch (e) { console.warn('[agente] no se pudo re-verificar pausa antes de enviar:', e) }

  // El provider id se guarda para el dedupe de echoes de IG (los envíos por API
  // también llegan como echo al webhook; con el id registrado no se duplican).
  const pid = (e: { id?: string; message_id?: string }) => e.id ?? e.message_id ?? null
  if (r.mensaje) {
    const env = esIg ? await enviarTextoInstagram(destino, r.mensaje) : await enviarTextoWhatsapp(destino, r.mensaje)
    await insertarMensaje({
      conversacion_id: conv.id, direccion: 'saliente', cuerpo: r.mensaje,
      tipo: 'texto', estado: env.ok ? 'enviado' : 'fallido', enviado_por: 'agente',
      provider_message_id: env.ok ? pid(env as { id?: string; message_id?: string }) : null,
    })
  }

  // Fotos del banco que el agente decidió enviar (flag whatsapp). Se mandan
  // después del texto y se registran en el inbox como mensajes de imagen.
  if (r.imagenes && r.imagenes.length) {
    for (const img of r.imagenes) {
      const me = esIg
        ? await enviarImagenInstagram(destino, img.url)
        : await enviarMediaWhatsapp(destino, { tipo: 'image', link: img.url })
      await insertarMensaje({
        conversacion_id: conv.id, direccion: 'saliente', cuerpo: img.alt || '',
        tipo: 'imagen', media_url: img.url, estado: me.ok ? 'enviado' : 'fallido', enviado_por: 'agente',
        provider_message_id: me.ok ? pid(me as { id?: string; message_id?: string }) : null,
      })
    }
  }

  if (r.escalar) {
    const tags = Array.from(new Set([...(conv.etiquetas || []), 'pausado', 'requiere-humano']))
    await actualizarConversacion(conv.id, { etiquetas: tags })
    // Aviso al admin por WhatsApp: una conversación necesita atención humana
    // (reclamo, solicitud especial/postventa, etc.). Best-effort. La conversación
    // queda 'pausada' → el agente no vuelve a responder hasta que la retomes.
    try {
      const ultimoCliente = [...historial].reverse().find(h => h.rol === 'cliente')?.texto || ''
      const nombre = contacto.nombre || 'Cliente'
      const donde = esIg ? `Instagram: ${contacto.nombre || 'DM'} (responder desde el inbox)` : `WhatsApp: +${destino}`
      const aviso = `⚠️ *Atención requerida* — el bot derivó una conversación a una persona.\n\n` +
        `Cliente: ${nombre}\n${donde}\n` +
        (ultimoCliente ? `Último mensaje: "${ultimoCliente.slice(0, 220)}"\n` : '') +
        `\nLa pauso para que la retomes tú desde el inbox.`
      await avisarAdminsWhatsapp(aviso)
    } catch (e) { console.warn('[agente] aviso de escalamiento al admin falló:', e) }
  }
}

/** Verificación del webhook (Meta hace un GET con hub.* al configurarlo). */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')
  const esperado = process.env.WHATSAPP_VERIFY_TOKEN
  if (mode === 'subscribe' && token && esperado) {
    // Comparación timing-safe: hasheamos ambos para igualar largos.
    const a = crypto.createHash('sha256').update(token).digest()
    const b = crypto.createHash('sha256').update(esperado).digest()
    if (crypto.timingSafeEqual(a, b)) {
      return new NextResponse(challenge ?? '', { status: 200 })
    }
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
  /** Presente en los echoes de coexistence (smb_message_echoes): destinatario (el cliente). */
  to?: string
  text?: { body: string }
  image?: { id: string; caption?: string; mime_type?: string }
  audio?: { id: string; mime_type?: string }
  voice?: { id: string; mime_type?: string }
  video?: { id: string; caption?: string; mime_type?: string }
  document?: { id: string; caption?: string; filename?: string; mime_type?: string }
  interactive?: { type?: string; button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } }
  /** Presente cuando el mensaje es una RESPUESTA citando otro (id = wamid citado). */
  context?: { id?: string; from?: string }
  [k: string]: unknown
}

/**
 * Flujo A — el admin tocó un botón ✅/❌ en la solicitud de retiro que le envió
 * el agente. Si el botón es nuestro y viene del número admin, procesa la
 * confirmación/rechazo: avisa al cliente por WhatsApp y cierra la solicitud.
 * Devuelve true si consumió el mensaje (no debe seguir el flujo normal).
 */
async function procesarBotonAdmin(msg: MetaMsg): Promise<boolean> {
  const br = msg.interactive?.button_reply
  if (!br?.id) return false
  const m = /^retiro_(ok|no):(\d+)$/.exec(br.id)
  if (!m) return false
  // Las solicitudes de retiro las puede resolver TODO el equipo con avisos ON
  // (incluidos operadores), no solo los admins.
  if (!(await esDestinatarioRetiros(msg.from))) return true

  // La lógica de confirmar/rechazar (cierre atómico + efectos + avisos) vive en
  // lib/solicitudes-retiro y la comparte el PANEL de la app.
  const { resultado, acuseAdmin } = await resolverSolicitudRetiro(m[2], m[1] === 'ok')
  if (resultado === 'confirmada' || resultado === 'rechazada') {
    // Resolución EFECTIVA (esta persona ganó el cierre atómico) → avisar a TODO el
    // equipo de retiros, así todos ven que quedó resuelta y quién la resolvió.
    await avisarEquipoRetiros(acuseAdmin)
  } else {
    // Ya estaba resuelta (o no existe): el 2º que toca el botón. El acuse va SOLO a
    // quien clickeó, para no spamear "ya había sido confirmada" al resto del equipo
    // (sobre todo a quien ya la confirmó). Best-effort.
    try { await enviarTextoWhatsapp(msg.from, acuseAdmin) } catch { /* no bloquea */ }
  }
  return true
}

/**
 * Relay — el admin RESPONDIÓ (citando) un aviso de "¿cuánto falta para el
 * retiro?". El context.id de la cita matchea el message_id que guardamos en
 * relay_retiro; reenviamos la respuesta del admin al cliente. Devuelve true si
 * consumió el mensaje.
 */
async function procesarRelayAdmin(msg: MetaMsg): Promise<boolean> {
  if (!(await esDestinatarioAvisos(msg.from))) return false
  const texto = msg.text?.body?.trim()
  if (!texto) return false
  // Si citó el aviso, match exacto; si no, solo si hay UNA sola consulta pendiente
  // (inequívoca). Con varias abiertas y sin cita, no reenviamos a nadie.
  let relay = msg.context?.id ? await buscarRelayPendientePorMsg(msg.context.id) : null
  if (!relay) relay = await buscarRelayPendienteUnico()
  if (!relay) return false // no hay consulta pendiente (o ambigua) → sigue flujo normal

  const cliente = (relay.cliente_wa_id || '').replace(/\D/g, '')

  // Reclamar el relay de forma ATÓMICA antes de enviar: una re-entrega del webhook
  // (o dos respuestas del admin casi simultáneas) no debe reenviar dos veces al
  // cliente. Si ya lo tomó otra ejecución, consumimos el mensaje y salimos.
  if (!(await marcarRelayRespondida(relay.id))) return true

  // El agente LEE tu respuesta y redacta el mensaje al cliente en la voz de marca.
  // Fallback (si la IA no está disponible o falla): reenvío simple de tu texto.
  let mensajeCliente = ''
  try {
    mensajeCliente = await redactarRelayCliente({ notaEquipo: texto, mascota: relay.mascota, nombreCliente: relay.cliente_nombre })
  } catch (e) {
    console.warn('[webhook] redactarRelayCliente falló, reenvío simple:', e)
  }
  if (!mensajeCliente) {
    const mascota = relay.mascota ? ` de ${relay.mascota}` : ''
    mensajeCliente = `Sobre el retiro${mascota}: ${texto} 🐾`
  }
  const env = await enviarTextoWhatsapp(cliente, mensajeCliente)

  // Registrar el reenvío en la conversación del cliente (inbox).
  try {
    const cont = await upsertContacto({ wa_id: cliente, telefono: cliente, audiencia: 'A' })
    const conv = await getOrCreateConversacion(cont.id, 'whatsapp', cont.audiencia, 'whatsapp')
    await insertarMensaje({
      conversacion_id: conv.id, direccion: 'saliente', cuerpo: mensajeCliente,
      tipo: 'texto', estado: env.ok ? 'enviado' : 'fallido', enviado_por: 'agente',
    })
  } catch (e) { console.warn('[webhook] no se pudo registrar el relay al cliente:', e) }

  await avisarAdminsWhatsapp(
    env.ok
      ? `✅ Le reenvié tu respuesta a ${relay.cliente_nombre || 'el cliente'}.`
      : `⚠ No pude reenviar al cliente (${env.fuera_de_ventana ? 'pasaron más de 24h y WhatsApp no permite escribirle' : env.error}).`,
  )
  return true
}

async function procesarEntrante(value: Record<string, unknown>, msg: MetaMsg) {
  if (await existeMensajePorProvider(msg.id)) return // dedupe

  const contacts = (value.contacts as Array<{ wa_id?: string; profile?: { name?: string } }>) ?? []
  const nombre = contacts.find(c => c.wa_id === msg.from)?.profile?.name || contacts[0]?.profile?.name || null

  const contacto = await upsertContacto({ wa_id: msg.from, telefono: msg.from, nombre, audiencia: 'A' })
  const conv = await getOrCreateConversacion(contacto.id, 'whatsapp', contacto.audiencia, 'whatsapp')
  // Auto-clasificación de la conversación al llegar un mensaje:
  //  - si el número es de un VETERINARIO → 'veterinario';
  //  - si estaba 'archivado' o 'cerrado' (histórico) y vuelve a escribir → reactivar a 'activo'.
  // No pisa 'cliente' (servicio en curso) ni 'veterinario'.
  try {
    const estadoActual = normalizarEstado(conv.estado)
    if (await esTelefonoVet(msg.from)) {
      if (estadoActual !== 'veterinario') await actualizarConversacion(conv.id, { estado: 'veterinario' })
    } else if (estadoActual === 'archivado' || estadoActual === 'cerrado') {
      await actualizarConversacion(conv.id, { estado: 'activo' })
    }
  } catch (e) { console.warn('[webhook] auto-clasificación falló:', e) }

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

  try {
    await insertarMensaje({
      conversacion_id: conv.id,
      direccion: 'entrante',
      cuerpo,
      tipo,
      media_url: mediaUrl,
      provider_message_id: msg.id,
      ts: new Date(Number(msg.timestamp) * 1000 || Date.now()).toISOString(),
    })
  } catch (e) {
    // Si existe el índice único de provider_message_id (ver tanda3-uniques.sql),
    // una segunda entrega del MISMO mensaje (Meta entrega at-least-once) choca acá:
    // es dedupe ganado por otra request → salimos sin disparar el agente de nuevo.
    const m = String(e).toLowerCase()
    if ((m.includes('duplicate') || m.includes('unique')) && m.includes('provider')) return
    throw e
  }

  // Auto-respuesta del agente solo para mensajes de texto, tras responder a Meta.
  if (msg.type === 'text' && cuerpo) {
    after(() => autoResponder(conv, contacto).catch(e => console.error('[agente] autoResponder:', e)))
  }
}

/**
 * Coexistence — `smb_message_echoes`: un mensaje que el negocio envió DESDE la
 * WhatsApp Business app (no por la API). Lo registramos como saliente (humano) en
 * el inbox y PAUSAMOS la conversación, para que el agente no responda encima. Es
 * el mismo guardrail que cuando un humano responde desde nuestro inbox.
 * (Los mensajes enviados por la API NO llegan como echo, así que esto solo
 * dispara cuando respondes tú a mano desde el teléfono/escritorio.)
 */
async function procesarEcho(echo: MetaMsg) {
  if (!echo?.id) return
  if (await existeMensajePorProvider(echo.id)) return // dedupe (entrega at-least-once)
  const cliente = (echo.to || '').replace(/\D/g, '')
  if (!cliente) return

  const contacto = await upsertContacto({ wa_id: cliente, telefono: cliente, audiencia: 'A' })
  const conv = await getOrCreateConversacion(contacto.id, 'whatsapp', contacto.audiencia, 'whatsapp')

  const tipo = tipoInterno(echo.type)
  let cuerpo: string | null = null
  if (echo.type === 'text') cuerpo = echo.text?.body ?? ''
  else {
    const mediaObj = (echo.image || echo.audio || echo.voice || echo.video || echo.document) as { caption?: string } | undefined
    cuerpo = mediaObj?.caption ?? `[${tipo}]`
  }

  try {
    await insertarMensaje({
      conversacion_id: conv.id, direccion: 'saliente', cuerpo, tipo,
      provider_message_id: echo.id, estado: 'enviado', enviado_por: 'humano',
      ts: new Date(Number(echo.timestamp) * 1000 || Date.now()).toISOString(),
    })
  } catch (e) {
    const m = String(e).toLowerCase()
    if ((m.includes('duplicate') || m.includes('unique')) && m.includes('provider')) return
    throw e
  }

  // Respuesta manual desde la app → pausar al agente (si no estaba pausada ya).
  if (!(conv.etiquetas || []).includes('pausado')) {
    const tags = Array.from(new Set([...(conv.etiquetas || []), 'pausado']))
    await actualizarConversacion(conv.id, { etiquetas: tags })
  }
}

// ─── Instagram (Messenger API for Instagram) ─────────────────────────────────
interface IgEvento {
  sender?: { id?: string }
  recipient?: { id?: string }
  timestamp?: number
  message?: {
    mid?: string
    text?: string
    is_echo?: boolean
    is_deleted?: boolean
    attachments?: Array<{ type?: string; payload?: { url?: string } }>
  }
  read?: unknown
  reaction?: unknown
  postback?: unknown
}

const IG_TIPO: Record<string, string> = { image: 'imagen', video: 'video', audio: 'audio', file: 'documento' }

/** DM entrante de Instagram → contacto/conversación canal 'instagram' + agente. */
async function procesarEntranteIG(ev: IgEvento) {
  const msg = ev.message
  const igsid = ev.sender?.id
  if (!msg?.mid || !igsid || msg.is_deleted) return
  if (await existeMensajePorProvider(msg.mid)) return // dedupe (at-least-once)

  // Echo (mensaje NUESTRO): si no lo registramos nosotros (el agente guarda su
  // provider id), lo mandó un humano desde la app de Instagram → registrarlo y
  // PAUSAR la conversación (mismo guardrail que coexistence de WhatsApp).
  if (msg.is_echo) {
    const cliente = ev.recipient?.id
    if (!cliente) return
    const contacto = await upsertContacto({ instagram: cliente, audiencia: 'A' })
    const conv = await getOrCreateConversacion(contacto.id, 'instagram', contacto.audiencia, 'instagram')
    try {
      await insertarMensaje({
        conversacion_id: conv.id, direccion: 'saliente', cuerpo: msg.text ?? '[mensaje]',
        tipo: 'texto', provider_message_id: msg.mid, estado: 'enviado', enviado_por: 'humano',
        ts: new Date(ev.timestamp || Date.now()).toISOString(),
      })
    } catch (e) {
      const m = String(e).toLowerCase()
      if ((m.includes('duplicate') || m.includes('unique')) && m.includes('provider')) return
      throw e
    }
    if (!(conv.etiquetas || []).includes('pausado')) {
      await actualizarConversacion(conv.id, { etiquetas: Array.from(new Set([...(conv.etiquetas || []), 'pausado'])) })
    }
    return
  }

  // Nombre/username del perfil (best-effort; en dev mode puede no venir).
  let nombre: string | null = null
  try {
    const p = await perfilInstagram(igsid)
    nombre = p.nombre ? (p.username ? `${p.nombre} (@${p.username})` : p.nombre) : (p.username ? `@${p.username}` : null)
  } catch { /* best-effort */ }

  const contacto = await upsertContacto({ instagram: igsid, nombre, audiencia: 'A' })
  const conv = await getOrCreateConversacion(contacto.id, 'instagram', contacto.audiencia, 'instagram')
  try {
    const estadoActual = normalizarEstado(conv.estado)
    if (estadoActual === 'archivado' || estadoActual === 'cerrado') {
      await actualizarConversacion(conv.id, { estado: 'activo' })
    }
  } catch (e) { console.warn('[webhook ig] reactivación falló:', e) }

  let cuerpo: string | null = msg.text ?? null
  let tipo = 'texto'
  let mediaUrl: string | null = null
  const adj = (msg.attachments || [])[0]
  if (adj?.payload?.url) {
    tipo = IG_TIPO[adj.type || ''] || 'documento'
    if (!cuerpo) cuerpo = null
    // El CDN de IG entrega URLs públicas temporales → persistimos en R2.
    try {
      const res = await fetch(adj.payload.url)
      if (res.ok) {
        const mime = res.headers.get('content-type') || 'application/octet-stream'
        const ext = EXT[mime] || 'bin'
        const buf = Buffer.from(await res.arrayBuffer())
        const r = await uploadToR2(buf, `mensajes/media/ig-${msg.mid.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)}.${ext}`, mime)
        mediaUrl = r.url
      }
    } catch (e) { console.warn('[webhook ig] media falló', e) }
    if (!mediaUrl) cuerpo = cuerpo ?? `[${tipo}]`
  }
  if (!cuerpo && !mediaUrl) cuerpo = '[mensaje]'

  try {
    await insertarMensaje({
      conversacion_id: conv.id, direccion: 'entrante', cuerpo, tipo,
      media_url: mediaUrl, provider_message_id: msg.mid,
      ts: new Date(ev.timestamp || Date.now()).toISOString(),
    })
  } catch (e) {
    const m = String(e).toLowerCase()
    if ((m.includes('duplicate') || m.includes('unique')) && m.includes('provider')) return
    throw e
  }

  if (msg.text) {
    after(() => autoResponder(conv, contacto).catch(e => console.error('[agente ig] autoResponder:', e)))
  }
}

/** Coexistence — avisos de desconexión/reconexión del número. Best-effort. */
async function avisarCoexistence(field: string) {
  const txt = field === 'account_offboarded'
    ? '⚠️ *WhatsApp Coexistence*: el número se DESCONECTÓ del sistema (account_offboarded). El bot dejó de recibir/responder. Hay que reconectarlo.'
    : '✅ *WhatsApp Coexistence*: el número se reconectó al sistema (account_reconnected). El bot vuelve a operar.'
  try { await avisarAdminsWhatsapp(txt) } catch (e) { console.warn('[webhook] aviso coexistence falló:', e) }
}

/** Recepción de eventos (mensajes entrantes + cambios de estado). */
export async function POST(req: NextRequest) {
  const raw = await req.text()
  const sig = req.headers.get('x-hub-signature-256')
  if (!verificarFirmaWebhook(raw, sig)) {
    return NextResponse.json({ error: 'firma inválida' }, { status: 401 })
  }
  let body: { object?: string; entry?: Array<{ changes?: Array<{ field?: string; value?: Record<string, unknown> }>; messaging?: IgEvento[] }> }
  try { body = JSON.parse(raw) } catch { return NextResponse.json({ ok: true }) }

  // Instagram: los DMs llegan con object='instagram' y formato messaging[] (no changes[]).
  if (body.object === 'instagram') {
    try {
      for (const entry of body.entry ?? []) {
        for (const ev of entry.messaging ?? []) {
          if (ev.read || ev.reaction || ev.postback) continue // eventos sin cuerpo: ignorar
          await procesarEntranteIG(ev)
        }
      }
    } catch (e) { console.error('[instagram webhook] error procesando:', e) }
    return NextResponse.json({ ok: true })
  }

  try {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {}
        // Coexistence: el número se desconectó/reconectó del sistema.
        if (change.field === 'account_offboarded' || change.field === 'account_reconnected') {
          await avisarCoexistence(change.field)
          continue
        }
        for (const st of (value.statuses as Array<{ id?: string; status?: string }>) ?? []) {
          if (st.id && st.status && ESTADO_MAP[st.status]) await marcarEstadoMensaje(st.id, ESTADO_MAP[st.status])
        }
        for (const msg of (value.messages as MetaMsg[]) ?? []) {
          // Flujo A: respuesta del admin a una solicitud de retiro (botón ✅/❌).
          if (msg.type === 'interactive' && await procesarBotonAdmin(msg)) continue
          // Relay: el admin respondió (citando) un aviso de ETA → reenviar al cliente.
          if (msg.type === 'text' && await procesarRelayAdmin(msg)) continue
          await procesarEntrante(value, msg)
        }
        // Coexistence: mensajes que enviaste TÚ desde la WhatsApp Business app.
        for (const echo of (value.message_echoes as MetaMsg[]) ?? []) {
          await procesarEcho(echo)
        }
      }
    }
  } catch (e) {
    console.error('[whatsapp webhook] error procesando:', e)
  }
  // Siempre 200 para que Meta no reintente en loop.
  return NextResponse.json({ ok: true })
}
