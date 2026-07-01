import { getSheetData, updateByIdIf } from './datastore'
import { crearClienteBorrador } from './cliente-borrador'
import { createBorradorToken } from './borrador-token'
import { enviarRetiroConfirmadoVet } from './vet-cremacion-mailer'
import { enviarTextoWhatsapp } from './whatsapp'
import { upsertContacto, getOrCreateConversacion, insertarMensaje } from './mensajes'
import { formatDate, todayISO, formatDateForSheet } from './dates'

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
 * Retiros CONFIRMADOS y todavía PRÓXIMOS (fecha de retiro hoy o a futuro). Quedan
 * visibles en el dashboard como ficha del retiro coordinado; cuando pasa la fecha,
 * dejan de mostrarse. Ordenados por fecha+hora (el más próximo primero).
 */
export async function listarSolicitudesConfirmadas(): Promise<SolicitudRetiro[]> {
  const hoy = todayISO()
  const rows = await getSheetData('solicitudes_retiro')
  const isoFecha = (s: SolicitudRetiro) => formatDateForSheet(s.fecha_retiro) || s.fecha_retiro
  return rows
    .filter(r => (r.estado || '') === 'confirmada')
    .map(toSolicitud)
    .filter(s => isoFecha(s) >= hoy)
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
  const gano = await updateByIdIf(
    'solicitudes_retiro',
    String(solicitudId),
    { estado: 'pendiente' },
    { estado: confirmado ? 'confirmada' : 'rechazada', fecha_resolucion: new Date().toISOString() },
  )
  if (!gano) return { resultado: 'ya_resuelta', acuseAdmin: `La solicitud N° ${solicitudId} ya estaba resuelta.` }

  const waCliente = (sol.cliente_wa_id || '').replace(/\D/g, '')
  const base = (process.env.NEXTAUTH_URL || 'https://petcrem.vercel.app').replace(/\/$/, '')
  const esVet = sol.origen === 'bot_vet' || !!sol.veterinaria_id

  let msgCliente: string
  let acuseAdmin: string

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
    acuseAdmin = `✅ Retiro N° ${solicitudId} (veterinario ${sol.vet_nombre || ''}) confirmado. Le avisamos por WhatsApp y le enviamos el correo de confirmación; queda como borrador "Por ingresar".`
  } else if (confirmado) {
    // ── Retiro de TUTOR: confirmación SOLO por WhatsApp + link firmado para adelantar datos.
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
    } catch (e) { console.warn('[solicitudes-retiro] no se pudo crear cliente borrador:', e) }

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
    } catch (e) { console.warn('[solicitudes-retiro] no se pudo registrar aviso al cliente:', e) }
  }

  return { resultado: confirmado ? 'confirmada' : 'rechazada', acuseAdmin }
}
