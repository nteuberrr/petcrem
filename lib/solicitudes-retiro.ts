import { getSheetData, updateByIdIf, updateById } from './datastore'
import { crearClienteBorrador } from './cliente-borrador'
import { createBorradorToken } from './borrador-token'
import { enviarRetiroConfirmadoVet } from './vet-cremacion-mailer'
import { enviarTextoWhatsapp, enviarPlantillaWhatsapp, enviarPlantillaUrlWhatsapp, renderPlantillaWa, plantillasAprobadas, BASE_PUBLICA } from './whatsapp'
import { upsertContacto, getOrCreateConversacion, insertarMensaje, marcarConversacionPorTelefono, ventanaAbierta } from './mensajes'
import { formatDate, todayISO, formatDateForSheet } from './dates'
import { conflictosEnAgenda, describirConflictos } from './agenda'

/**
 * Solicitudes de retiro del bot de WhatsApp (tabla `solicitudes_retiro`).
 *
 * El agente registra la solicitud y hasta ahora el ÚNICO aviso al admin eran los
 * botones ✅/❌ por WhatsApp — que solo se entregan dentro de la ventana de 24h
 * (política de Meta), así que si el admin no tenía ventana abierta NUNCA llegaban.
 * Este módulo expone el mismo flujo de confirmar/rechazar para consumirlo también
 * desde el PANEL de la app (canal confiable, sin depender de WhatsApp).
 *
 * `resolverSolicitudRetiro` es la lógica compartida: la usa el webhook (botón) y la
 * API del panel. Cierra la solicitud de forma ATÓMICA (pendiente→confirmada/rechazada)
 * y dispara los efectos: crea la ficha borrador, avisa por WhatsApp a quien pidió el
 * retiro, y (para vets) manda el correo de confirmación B2B.
 */

export interface SolicitudRetiro {
  id: string
  cliente_wa_id: string
  cliente_nombre: string
  nombre_mascota: string
  peso: string
  direccion: string
  comuna: string
  fecha_retiro: string
  hora_retiro: string
  tipo_servicio: string
  estado: string
  origen: string
  veterinaria_id: string
  vet_nombre: string
  vet_email: string
  /** Ficha borrador (clientes) creada al confirmar. Vacío mientras esté pendiente. */
  cliente_id: string
  fecha_creacion: string
  fecha_resolucion: string
}

function toSolicitud(r: Record<string, string>): SolicitudRetiro {
  return {
    id: r.id || '',
    cliente_wa_id: r.cliente_wa_id || '',
    cliente_nombre: r.cliente_nombre || '',
    nombre_mascota: r.nombre_mascota || '',
    peso: r.peso || '',
    direccion: r.direccion || '',
    comuna: r.comuna || '',
    fecha_retiro: r.fecha_retiro || '',
    hora_retiro: r.hora_retiro || '',
    tipo_servicio: r.tipo_servicio || '',
    estado: r.estado || '',
    origen: r.origen || '',
    veterinaria_id: r.veterinaria_id || '',
    vet_nombre: r.vet_nombre || '',
    vet_email: r.vet_email || '',
    cliente_id: r.cliente_id || '',
    fecha_creacion: r.fecha_creacion || '',
    fecha_resolucion: r.fecha_resolucion || '',
  }
}

/** Solicitudes pendientes de confirmación, la más nueva primero. */
export async function listarSolicitudesPendientes(): Promise<SolicitudRetiro[]> {
  const rows = await getSheetData('solicitudes_retiro')
  return rows
    .filter(r => (r.estado || '') === 'pendiente')
    .map(toSolicitud)
    .sort((a, b) => (parseInt(b.id, 10) || 0) - (parseInt(a.id, 10) || 0))
}

/**
 * Retiros CONFIRMADOS que todavía están "por ingresar". Quedan visibles en el
 * dashboard como ficha del retiro coordinado hasta que el equipo REGISTRA la
 * ficha (la borrador deja de ser borrador → desaparece el cuadro verde).
 *
 * - Con `cliente_id` (link a la ficha borrador): se muestra solo mientras esa
 *   ficha exista y siga en estado 'borrador'. Registrada o borrada → oculta.
 * - Sin `cliente_id` (solicitudes viejas, previas a este link): se usa el criterio
 *   anterior (fecha de retiro hoy o a futuro) como respaldo.
 * Ordenados por fecha+hora (el más próximo primero).
 */
export async function listarSolicitudesConfirmadas(): Promise<SolicitudRetiro[]> {
  const hoy = todayISO()
  const [rows, clientes] = await Promise.all([
    getSheetData('solicitudes_retiro'),
    getSheetData('clientes'),
  ])
  const esBorradorVivo = (clienteId: string) => {
    const c = clientes.find(r => String(r.id) === String(clienteId))
    return !!c && (c.estado || '') === 'borrador'
  }
  const isoFecha = (s: SolicitudRetiro) => formatDateForSheet(s.fecha_retiro) || s.fecha_retiro
  return rows
    .filter(r => (r.estado || '') === 'confirmada')
    .map(toSolicitud)
    .filter(s => (s.cliente_id ? esBorradorVivo(s.cliente_id) : isoFecha(s) >= hoy))
    .sort((a, b) => isoFecha(a).localeCompare(isoFecha(b)) || (a.hora_retiro || '').localeCompare(b.hora_retiro || ''))
}

export type ResultadoResolucion = 'confirmada' | 'rechazada' | 'ya_resuelta' | 'no_existe'

/**
 * Confirma o rechaza una solicitud de retiro. Mismo efecto que el botón de WhatsApp:
 *  - cierre ATÓMICO pendiente→(confirmada|rechazada);
 *  - si se confirma: crea la ficha borrador ("Por ingresar") y avisa por WhatsApp a
 *    quien pidió el retiro (tutor: + link para adelantar datos; vet: + correo B2B);
 *  - si se rechaza: avisa que un agente lo contactará.
 * Devuelve un `acuseAdmin` (texto) para mostrar en el panel o mandar por WhatsApp.
 */
export async function resolverSolicitudRetiro(
  solicitudId: string,
  confirmado: boolean,
): Promise<{ resultado: ResultadoResolucion; acuseAdmin: string }> {
  const rows = await getSheetData('solicitudes_retiro')
  const sol = rows.find(r => r.id === String(solicitudId))
  if (!sol) return { resultado: 'no_existe', acuseAdmin: `No encontré la solicitud N° ${solicitudId}.` }

  // Cierre ATÓMICO: solo procede quien gana el cambio pendiente→resuelta. Evita
  // doble borrador / doble aviso si el botón y el panel (o dos clics) coinciden.
  const ahora = new Date().toISOString()
  const gano = await updateByIdIf(
    'solicitudes_retiro',
    String(solicitudId),
    { estado: 'pendiente' },
    { estado: confirmado ? 'confirmada' : 'rechazada', fecha_resolucion: ahora },
  )
  if (!gano) return { resultado: 'ya_resuelta', acuseAdmin: `La solicitud N° ${solicitudId} ya estaba resuelta.` }

  const waCliente = (sol.cliente_wa_id || '').replace(/\D/g, '')
  const base = (process.env.NEXTAUTH_URL || 'https://petcrem.vercel.app').replace(/\/$/, '')
  const esVet = sol.origen === 'bot_vet' || !!sol.veterinaria_id

  // REVALIDACIÓN al confirmar. Entre que el bot registra la solicitud y el equipo
  // toca ✅ pueden pasar horas: la hora pudo ocuparse (otro agendamiento, una
  // eutanasia) o la fecha pudo quedar en el pasado. No se bloquea la confirmación
  // —el compromiso con el cliente ya existe— pero el acuse lo dice con todas sus
  // letras para que el equipo reordene la ruta o llame.
  let alerta = ''
  if (confirmado) {
    try {
      const fechaISO = formatDateForSheet(sol.fecha_retiro) || String(sol.fecha_retiro || '')
      if (fechaISO && fechaISO < todayISO()) {
        alerta = `\n⚠️ OJO: la fecha del retiro (${formatDate(sol.fecha_retiro)}) ya pasó. Coordínalo de nuevo con quien lo pidió.`
      } else {
        const choques = await conflictosEnAgenda(sol.fecha_retiro, sol.hora_retiro, `r${solicitudId}`)
        if (choques.length > 0) {
          alerta = `\n⚠️ OJO: choca con ${describirConflictos(choques)} (dejamos 30 min antes y 45 después). Revisa la ruta del chofer.`
        }
      }
    } catch (e) { console.warn('[solicitudes-retiro] no se pudo revalidar el horario al confirmar:', e) }
  }

  let msgCliente: string
  let acuseAdmin: string
  // Ficha borrador creada al confirmar; se linkea a la solicitud para que el
  // dashboard oculte el cuadro verde cuando la ficha se registre.
  let borradorId = ''
  /** Token del link para adelantar datos: va como link en el texto libre y como
   *  sufijo del botón en la plantilla (Meta solo deja variar el final del link). */
  let tokenFicha = ''

  if (confirmado && esVet) {
    // ── Retiro de VETERINARIO: borrador asociado al vet + correo de confirmación B2B.
    try {
      let tipoPrecios = 'general'
      let nombreContacto = ''
      try {
        const vets = await getSheetData('veterinarios')
        const vrow = vets.find(v => v.id === sol.veterinaria_id)
        const t = (vrow?.tipo_precios || '').toLowerCase()
        tipoPrecios = t.includes('especial') ? 'especial' : t.includes('convenio') ? 'convenio' : 'general'
        nombreContacto = vrow?.nombre_contacto || ''
      } catch { /* best-effort */ }

      borradorId = await crearClienteBorrador({
        nombre_mascota: sol.nombre_mascota,
        direccion_retiro: sol.direccion,
        comuna: sol.comuna,
        fecha_retiro: sol.fecha_retiro,
        hora_retiro: sol.hora_retiro,
        peso_declarado: sol.peso,
        codigo_servicio: sol.tipo_servicio,
        origen: 'bot_vet',
        veterinaria_id: sol.veterinaria_id,
        tipo_precios: tipoPrecios,
        notas: `Retiro de convenio solicitado por el veterinario ${sol.vet_nombre || ''} vía WhatsApp.`,
      })

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
        } catch (e) { console.warn('[solicitudes-retiro] no se pudo enviar correo de confirmación al vet:', e) }
      }
    } catch (e) { console.warn('[solicitudes-retiro] no se pudo crear borrador de vet:', e) }

    msgCliente = `Confirmado el retiro de ${sol.nombre_mascota} para el ${formatDate(sol.fecha_retiro)} a las ${sol.hora_retiro}. ` +
      `Te enviamos el detalle a tu correo. ¡Gracias por confiar en nosotros! 🐾`
    acuseAdmin = `✅ Retiro N° ${solicitudId} (veterinario ${sol.vet_nombre || ''}) confirmado. Le avisamos por WhatsApp y le enviamos el correo de confirmación; queda como borrador "Por ingresar".${alerta}`
  } else if (confirmado) {
    // ── Retiro de TUTOR: confirmación SOLO por WhatsApp + link firmado para adelantar datos.
    let linkFicha = `${base}/registro-mascota`
    try {
      borradorId = await crearClienteBorrador({
        nombre_tutor: sol.cliente_nombre,
        nombre_mascota: sol.nombre_mascota,
        telefono: waCliente,
        direccion_retiro: sol.direccion,
        comuna: sol.comuna,
        fecha_retiro: sol.fecha_retiro,
        hora_retiro: sol.hora_retiro,
        peso_declarado: sol.peso,
        codigo_servicio: sol.tipo_servicio,
        origen: 'bot_retiro',
        notas: 'Creado desde una solicitud de retiro del bot de WhatsApp.',
      })
      tokenFicha = createBorradorToken(borradorId)
      // El MISMO token en sus dos formas: link completo para el texto libre y
      // sufijo suelto para el botón de la plantilla (Meta solo deja variar el
      // final de una URL aprobada).
      linkFicha = `${BASE_PUBLICA}/f/${tokenFicha}`
    } catch (e) { console.warn('[solicitudes-retiro] no se pudo crear cliente borrador:', e) }

    msgCliente = `Tu retiro quedó confirmado para el ${formatDate(sol.fecha_retiro)} a las ${sol.hora_retiro}.\n\n` +
      `Si quieres, puedes adelantar los datos de tu mascota aquí:\n${linkFicha}\n\n` +
      `No es obligatorio: si no alcanzas, te los pedimos al momento del retiro. Gracias por confiar en nosotros 🐾`
    acuseAdmin = `✅ Retiro N° ${solicitudId} confirmado. Le enviamos al cliente el link para completar su ficha (queda como borrador "Por ingresar"; el código se genera cuando registres la ficha).${alerta}`
  } else {
    // ── Rechazo (tutor o vet).
    msgCliente = `Gracias por escribirnos. Un agente de nuestro equipo se pondrá en contacto contigo a la brevedad para coordinar. 🐾`
    acuseAdmin = `❌ Retiro N° ${solicitudId} rechazado. Avisamos que un agente lo contactará.`
  }

  // Linkear la ficha borrador recién creada a la solicitud confirmada, para que el
  // dashboard oculte el cuadro verde cuando esa ficha se registre. Best-effort.
  if (confirmado && borradorId) {
    try {
      // Update PARCIAL: antes se reescribía la fila entera con el snapshot leído
      // ANTES del cierre atómico, así que pisaba cualquier cambio hecho en el
      // intertanto (p. ej. una reprogramación simultánea).
      await updateByIdIf('solicitudes_retiro', String(solicitudId), {}, { cliente_id: borradorId })
    } catch (e) { console.warn('[solicitudes-retiro] no se pudo linkear cliente_id:', e) }
  }

  // ── Avisarle por WhatsApp a quien pidió el retiro ──────────────────────────
  //
  // ⚠️ La VENTANA se consulta ANTES de enviar, no se deduce del error. Con la
  // ventana cerrada Meta responde 200 con message_id y descarta el mensaje: el
  // respaldo por plantilla —que se disparaba con `fuera_de_ventana`— nunca
  // corría, y el mensaje quedaba «enviado» en el inbox para siempre.
  //
  // Eso rompía justo el caso del agendamiento MANUAL: ahí el tutor nos habló por
  // teléfono y NUNCA nos escribió por WhatsApp, así que no hay ventana que valga.
  // Comprobado el 12-08-2026 con Inna: se le mandó la confirmación a las 21:21 y
  // a las 21:58 escribió «coordiné para hoy el servicio…», como si nadie le
  // hubiera contestado — porque nadie le había llegado. Los retiros que vienen
  // del bot no lo sufrían: ahí el tutor acababa de escribir.
  if (waCliente) {
    let convId: number | null = null
    let abierta = false
    try {
      const cont = await upsertContacto({ wa_id: waCliente, telefono: waCliente, audiencia: 'A' })
      const conv = await getOrCreateConversacion(cont.id, 'whatsapp', cont.audiencia, 'whatsapp')
      convId = conv.id
      abierta = await ventanaAbierta(conv.id)
    } catch (e) { console.warn('[solicitudes-retiro] no se pudo resolver la conversación:', e) }

    let env: { ok: boolean; message_id?: string; error?: string; fuera_de_ventana?: boolean } = { ok: false }
    let cuerpoEnviado = msgCliente
    // Con la ventana abierta va el texto libre: es gratis y lleva el link para
    // adelantar los datos, que la plantilla no puede llevar.
    if (abierta) env = await enviarTextoWhatsapp(waCliente, msgCliente)
    // Cerrada (o el texto libre rebotó): plantilla aprobada, lo ÚNICO que Meta
    // entrega fuera de la ventana. Se paga, pero llega — y con el botón de link
    // llega también el acceso para adelantar los datos.
    const aprobadas = (!abierta || (!env.ok && env.fuera_de_ventana)) ? await plantillasAprobadas() : new Set<string>()
    if (!abierta || (!env.ok && env.fuera_de_ventana)) {
      const tutor = (sol.cliente_nombre || '').trim().split(/\s+/)[0] || '👋'
      const vars = [tutor, sol.nombre_mascota || 'tu mascota', `el ${formatDate(sol.fecha_retiro)} a las ${sol.hora_retiro}`]
      // Preferida: la que lleva el link en un BOTÓN, así el tutor puede adelantar
      // los datos sin depender de que responda primero. Si todavía no está
      // aprobada por Meta, cae a la de siempre (avisa, pero sin link).
      if (confirmado && tokenFicha && aprobadas.has('retiro_confirmado_link')) {
        const envP = await enviarPlantillaUrlWhatsapp(waCliente, 'retiro_confirmado_link', vars, tokenFicha)
        if (envP.ok) {
          env = envP
          cuerpoEnviado = `${renderPlantillaWa('retiro_confirmado_link', vars)}\n[Botón: Completar datos → ${BASE_PUBLICA}/f/${tokenFicha}]`
        } else if (!env.ok) env = envP
      }
      if (!env.ok && confirmado && aprobadas.has('retiro_confirmado')) {
        const envP = await enviarPlantillaWhatsapp(waCliente, 'retiro_confirmado', vars)
        if (envP.ok) { env = envP; cuerpoEnviado = renderPlantillaWa('retiro_confirmado', vars) }
        else env = envP
      }
      if (!env.ok && !abierta) {
        // Sin plantilla no hay forma de llegarle: se intenta igual (por si la
        // ventana estaba abierta y no lo vimos) pero el acuse lo tiene que decir.
        env = await enviarTextoWhatsapp(waCliente, msgCliente)
        if (!env.ok) alerta += `\n⚠️ No se le pudo avisar por WhatsApp (${env.error || 'sin ventana de 24h y sin plantilla'}). Llámalo.`
      }
    }

    if (convId != null) {
      try {
        // El provider_message_id es lo que permite que el webhook de estados
        // escriba acá si Meta después falla el mensaje. Sin él, el inbox mostraba
        // «enviado» aunque no hubiera llegado nunca: ese era el punto ciego.
        await insertarMensaje({
          conversacion_id: convId, direccion: 'saliente', cuerpo: cuerpoEnviado,
          tipo: 'texto', estado: env.ok ? 'enviado' : 'fallido', enviado_por: 'agente',
          provider_message_id: env.message_id ?? null,
        })
      } catch (e) { console.warn('[solicitudes-retiro] no se pudo registrar aviso al cliente:', e) }
    }
  }

  // Al AGENDAR (confirmar) un retiro de TUTOR, su conversación pasa a 'cliente'.
  // En retiros de VET la conversación es la del veterinario → se deja como está.
  if (confirmado && !esVet && waCliente) {
    await marcarConversacionPorTelefono(waCliente, 'cliente', { soloSi: ['activo', 'archivado', 'cerrado'] })
  }

  return { resultado: confirmado ? 'confirmada' : 'rechazada', acuseAdmin }
}
