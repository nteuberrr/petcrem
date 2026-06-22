import crypto from 'node:crypto'
import { NextRequest, NextResponse, after } from 'next/server'
import { verificarFirmaWebhook, descargarMedia, tipoInterno, enviarTextoWhatsapp, enviarMediaWhatsapp, isWhatsappConfigured, adminWhatsapp } from '@/lib/whatsapp'
import {
  upsertContacto, getOrCreateConversacion, insertarMensaje, getMensajes,
  actualizarConversacion, existeMensajePorProvider, marcarEstadoMensaje, getConversacion,
  type Conversacion, type Contacto,
} from '@/lib/mensajes'
import { isAgenteConfigurado, generarRespuesta, redactarRelayCliente } from '@/lib/agente-mensajes'
import { handlersAgente } from '@/lib/agente-acciones'
import { getSheetData, updateByIdIf } from '@/lib/datastore'
import { crearClienteBorrador } from '@/lib/cliente-borrador'
import { createBorradorToken } from '@/lib/borrador-token'
import { enviarRetiroConfirmadoVet } from '@/lib/vet-cremacion-mailer'
import { buscarRelayPendientePorMsg, buscarRelayPendienteUnico, marcarRelayRespondida } from '@/lib/relay-retiro'
import { formatDate } from '@/lib/dates'
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
  try {
    r = await generarRespuesta(historial, {
      handlers: handlersAgente(),
      ctx: { waId: destino, nombreContacto: contacto.nombre ?? undefined },
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

  if (r.mensaje) {
    const env = await enviarTextoWhatsapp(destino, r.mensaje)
    await insertarMensaje({
      conversacion_id: conv.id, direccion: 'saliente', cuerpo: r.mensaje,
      tipo: 'texto', estado: env.ok ? 'enviado' : 'fallido', enviado_por: 'agente',
    })
  }

  // Fotos del banco que el agente decidió enviar (flag whatsapp). Se mandan
  // después del texto y se registran en el inbox como mensajes de imagen.
  if (r.imagenes && r.imagenes.length) {
    for (const img of r.imagenes) {
      const me = await enviarMediaWhatsapp(destino, { tipo: 'image', link: img.url })
      await insertarMensaje({
        conversacion_id: conv.id, direccion: 'saliente', cuerpo: img.alt || '',
        tipo: 'imagen', media_url: img.url, estado: me.ok ? 'enviado' : 'fallido', enviado_por: 'agente',
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
      const aviso = `⚠️ *Atención requerida* — el bot derivó una conversación a una persona.\n\n` +
        `Cliente: ${nombre}\nWhatsApp: +${destino}\n` +
        (ultimoCliente ? `Último mensaje: "${ultimoCliente.slice(0, 220)}"\n` : '') +
        `\nLa pauso para que la retomes tú desde el inbox.`
      await enviarTextoWhatsapp(adminWhatsapp(), aviso)
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
  // Solo el número admin puede confirmar/rechazar.
  if (msg.from.replace(/\D/g, '') !== adminWhatsapp()) return true

  const accion = m[1]
  const solicitudId = m[2]
  const rows = await getSheetData('solicitudes_retiro')
  const idx = rows.findIndex(r => r.id === solicitudId)
  if (idx === -1) {
    await enviarTextoWhatsapp(adminWhatsapp(), `No encontré la solicitud N° ${solicitudId}.`)
    return true
  }
  const sol = rows[idx]
  const confirmado = accion === 'ok'

  // Cerrar la solicitud de forma ATÓMICA antes de cualquier efecto secundario:
  // solo procede quien gana el cambio pendiente→(confirmada|rechazada). Meta
  // reentrega el evento del botón (at-least-once) y el admin puede tocarlo dos
  // veces; sin este compare-and-set se crearían DOS borradores y DOS avisos.
  const gano = await updateByIdIf(
    'solicitudes_retiro',
    solicitudId,
    { estado: 'pendiente' },
    { estado: confirmado ? 'confirmada' : 'rechazada', fecha_resolucion: new Date().toISOString() },
  )
  if (!gano) {
    await enviarTextoWhatsapp(adminWhatsapp(), `La solicitud N° ${solicitudId} ya estaba resuelta.`)
    return true
  }

  const waCliente = (sol.cliente_wa_id || '').replace(/\D/g, '')
  const base = (process.env.NEXTAUTH_URL || 'https://petcrem.vercel.app').replace(/\/$/, '')
  const esVet = sol.origen === 'bot_vet' || !!sol.veterinaria_id

  // Mensaje que se le manda por WhatsApp a quien pidió el retiro (tutor o vet).
  let msgCliente: string
  // Acuse al admin (se ajusta según el camino).
  let acuseAdmin: string

  if (confirmado && esVet) {
    // ── Retiro de VETERINARIO: borrador asociado al vet + correo de confirmación.
    // No mandamos link de tutor: el vet ya nos dio los datos y tenemos su correo.
    try {
      // Mapear el tipo de precios del vet → snapshot del cliente (convenio/especial).
      let tipoPrecios = 'general'
      let nombreContacto = ''
      try {
        const vets = await getSheetData('veterinarios')
        const vrow = vets.find(v => v.id === sol.veterinaria_id)
        const t = (vrow?.tipo_precios || '').toLowerCase()
        tipoPrecios = t.includes('especial') ? 'especial' : t.includes('convenio') ? 'convenio' : 'general'
        nombreContacto = vrow?.nombre_contacto || ''
      } catch { /* best-effort */ }

      await crearClienteBorrador({
        nombre_mascota: sol.nombre_mascota,
        direccion_retiro: sol.direccion,
        comuna: sol.comuna,
        fecha_retiro: sol.fecha_retiro,
        peso_declarado: sol.peso,
        codigo_servicio: sol.tipo_servicio,
        origen: 'bot_vet',
        veterinaria_id: sol.veterinaria_id,
        tipo_precios: tipoPrecios,
        notas: `Retiro de convenio solicitado por el veterinario ${sol.vet_nombre || ''} vía WhatsApp.`,
      })

      // Correo de confirmación al veterinario (best-effort).
      if (sol.vet_email) {
        try {
          await enviarRetiroConfirmadoVet({
            email: sol.vet_email,
            vetNombre: sol.vet_nombre || '',
            contacto: nombreContacto,
            nombreMascota: sol.nombre_mascota,
            fecha: formatDate(sol.fecha_retiro),
            hora: sol.hora_retiro,
          })
        } catch (e) { console.warn('[webhook] no se pudo enviar correo de confirmación al vet:', e) }
      }
    } catch (e) { console.warn('[webhook] no se pudo crear borrador de vet:', e) }

    msgCliente = `Confirmado el retiro de ${sol.nombre_mascota} para el ${formatDate(sol.fecha_retiro)} a las ${sol.hora_retiro}. ` +
      `Te enviamos el detalle a tu correo. ¡Gracias por confiar en nosotros! 🐾`
    acuseAdmin = `✅ Retiro N° ${solicitudId} (veterinario ${sol.vet_nombre || ''}) confirmado. Le avisamos por WhatsApp y le enviamos el correo de confirmación; queda como borrador "Por ingresar".`
  } else if (confirmado) {
    // ── Retiro de TUTOR (cliente general): confirmación SOLO por WhatsApp, SIN
    // correo. Creamos el borrador + un link FIRMADO para que adelante datos.
    // Completar el link NO genera código ni correo — eso lo hace el operador al
    // "Registrar ficha". (El correo de confirmación de retiro es exclusivo de los
    // agendamientos de veterinarios.)
    let linkFicha = `${base}/registro-mascota`
    try {
      const borradorId = await crearClienteBorrador({
        nombre_tutor: sol.cliente_nombre,
        nombre_mascota: sol.nombre_mascota,
        telefono: waCliente,
        direccion_retiro: sol.direccion,
        comuna: sol.comuna,
        fecha_retiro: sol.fecha_retiro,
        peso_declarado: sol.peso,
        codigo_servicio: sol.tipo_servicio,
        origen: 'bot_retiro',
        notas: 'Creado desde una solicitud de retiro del bot de WhatsApp.',
      })
      linkFicha = `${base}/registro-mascota?ficha=${createBorradorToken(borradorId)}`
    } catch (e) { console.warn('[webhook] no se pudo crear cliente borrador:', e) }

    msgCliente = `Tu retiro quedó confirmado para el ${formatDate(sol.fecha_retiro)} a las ${sol.hora_retiro}.\n\n` +
      `Si quieres, puedes adelantar los datos de tu mascota aquí:\n${linkFicha}\n\n` +
      `No es obligatorio: si no alcanzas, te los pedimos al momento del retiro. Gracias por confiar en nosotros 🐾`
    acuseAdmin = `✅ Retiro N° ${solicitudId} confirmado. Le enviamos al cliente el link para completar su ficha (queda como borrador "Por ingresar"; el código se genera cuando registres la ficha).`
  } else {
    // ── Rechazo (tutor o vet).
    msgCliente = `Gracias por escribirnos. Un agente de nuestro equipo se pondrá en contacto contigo a la brevedad para coordinar. 🐾`
    acuseAdmin = `❌ Retiro N° ${solicitudId} rechazado. Avisamos que un agente lo contactará.`
  }

  // Avisar por WhatsApp a quien pidió el retiro + registrar en su conversación.
  if (waCliente) {
    const env = await enviarTextoWhatsapp(waCliente, msgCliente)
    try {
      const cont = await upsertContacto({ wa_id: waCliente, telefono: waCliente, audiencia: 'A' })
      const conv = await getOrCreateConversacion(cont.id, 'whatsapp', cont.audiencia, 'whatsapp')
      await insertarMensaje({
        conversacion_id: conv.id, direccion: 'saliente', cuerpo: msgCliente,
        tipo: 'texto', estado: env.ok ? 'enviado' : 'fallido', enviado_por: 'agente',
      })
    } catch (e) { console.warn('[webhook] no se pudo registrar aviso al cliente:', e) }
  }

  await enviarTextoWhatsapp(adminWhatsapp(), acuseAdmin)
  return true
}

/**
 * Relay — el admin RESPONDIÓ (citando) un aviso de "¿cuánto falta para el
 * retiro?". El context.id de la cita matchea el message_id que guardamos en
 * relay_retiro; reenviamos la respuesta del admin al cliente. Devuelve true si
 * consumió el mensaje.
 */
async function procesarRelayAdmin(msg: MetaMsg): Promise<boolean> {
  if (msg.from.replace(/\D/g, '') !== adminWhatsapp()) return false
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

  await enviarTextoWhatsapp(
    adminWhatsapp(),
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

/** Coexistence — avisos de desconexión/reconexión del número. Best-effort. */
async function avisarCoexistence(field: string) {
  const txt = field === 'account_offboarded'
    ? '⚠️ *WhatsApp Coexistence*: el número se DESCONECTÓ del sistema (account_offboarded). El bot dejó de recibir/responder. Hay que reconectarlo.'
    : '✅ *WhatsApp Coexistence*: el número se reconectó al sistema (account_reconnected). El bot vuelve a operar.'
  try { await enviarTextoWhatsapp(adminWhatsapp(), txt) } catch (e) { console.warn('[webhook] aviso coexistence falló:', e) }
}

/** Recepción de eventos (mensajes entrantes + cambios de estado). */
export async function POST(req: NextRequest) {
  const raw = await req.text()
  const sig = req.headers.get('x-hub-signature-256')
  if (!verificarFirmaWebhook(raw, sig)) {
    return NextResponse.json({ error: 'firma inválida' }, { status: 401 })
  }
  let body: { entry?: Array<{ changes?: Array<{ field?: string; value?: Record<string, unknown> }> }> }
  try { body = JSON.parse(raw) } catch { return NextResponse.json({ ok: true }) }

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
