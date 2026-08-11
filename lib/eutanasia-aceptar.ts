import { getSheetData, updateById, updateByIdIf, ensureSheet, ensureColumns } from './datastore'
import { nombreCompletoVet, enviarCoordinarConFamilia, enviarClienteVetAsignado } from './eutanasia-mailer'
import { avisarClienteVetConfirmado } from './eutanasia-avisos'
import { marcarConversacionPorTelefono } from './mensajes'
import { formatDate } from './dates'

/**
 * Un vet TOMA una cotización de eutanasia — TODO lo que pasa al aceptar, en un
 * solo lugar.
 *
 * Lo comparten los dos caminos por los que un vet puede aceptar, y tienen que
 * hacer exactamente lo mismo (mismo problema que lib/despacho-entrega): el link
 * firmado del correo (`/api/eutanasias/cotizaciones/aceptar`) y el botón de la
 * plantilla de WhatsApp (lib/eutanasia-whatsapp). Si uno solo marca la
 * cotización y el otro además avisa al tutor, la mitad de los casos quedan sin
 * avisar y nadie se entera.
 */

const SHEET_COTI = 'cotizaciones_eutanasia'
const SHEET_ENVIOS = 'cotizaciones_eutanasia_envios'
const COLS_ENVIOS = ['id', 'cotizacion_id', 'vet_id', 'vet_email', 'fecha_envio', 'fecha_respuesta', 'estado_envio', 'resend_message_id']

export type MotivoRechazo = 'no_encontrada' | 'tomada' | 'cancelada' | 'vet_no_encontrado'

export type ResultadoAceptar =
  | { ok: true; ya_aceptada: boolean; c: Record<string, string>; vet: Record<string, string> }
  | { ok: false; motivo: MotivoRechazo; mensaje: string }

function baseUrlApp(): string {
  return (process.env.PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '').replace(/\/+$/, '')
}

/**
 * Marca la cotización como aceptada por este vet y dispara los efectos: correo
 * "coordina con la familia", aviso al tutor (WhatsApp + correo) y cierre de la
 * conversación del tutor.
 *
 * La toma del caso es ATÓMICA (`updateByIdIf` sobre estado='enviada'): si dos
 * vets aceptan casi a la vez, el segundo no matchea y se le responde que otro ya
 * la tomó. Los efectos son best-effort y no revierten la toma.
 */
export async function aceptarCotizacion(opts: {
  cotizacionId: string
  vetId: string
  /** Efectos posteriores (correos/avisos). El botón de WhatsApp los corre igual. */
  conEfectos?: boolean
}): Promise<ResultadoAceptar> {
  const { cotizacionId, vetId } = opts
  const conEfectos = opts.conEfectos !== false

  const cotis = await getSheetData(SHEET_COTI)
  const c = cotis.find(r => String(r.id) === String(cotizacionId))
  if (!c) return { ok: false, motivo: 'no_encontrada', mensaje: 'Solicitud no encontrada.' }

  const vets = await getSheetData('vet_convenio_eutanasia')
  const vet = vets.find(v => String(v.id) === String(vetId))
  if (!vet) return { ok: false, motivo: 'vet_no_encontrado', mensaje: 'Veterinario no encontrado.' }

  if (c.estado === 'aceptada' || c.estado === 'realizada') {
    if (String(c.vet_id_asignado) === String(vetId)) {
      return { ok: true, ya_aceptada: true, c, vet }
    }
    return { ok: false, motivo: 'tomada', mensaje: 'Otro veterinario ya tomó esta solicitud. Gracias por tu interés.' }
  }
  if (c.estado === 'cancelada') {
    return { ok: false, motivo: 'cancelada', mensaje: 'Esta solicitud fue cancelada.' }
  }

  // Toma ATÓMICA: solo gana si la cotización sigue en 'enviada'.
  const ahora = new Date().toISOString()
  const vetNombreCompleto = nombreCompletoVet(vet.nombre, vet.apellido)
  const gano = await updateByIdIf(
    SHEET_COTI,
    String(c.id),
    { estado: 'enviada' },
    {
      estado: 'aceptada',
      vet_id_asignado: vet.id,
      vet_nombre_asignado: vetNombreCompleto,
      vet_email_asignado: vet.email,
      fecha_aceptacion: ahora,
    },
  )
  if (!gano) {
    // Otro proceso cambió el estado entre la lectura y el update: re-leemos para
    // distinguir nuestro propio doble toque de otro vet que ganó la carrera.
    const fresco = (await getSheetData(SHEET_COTI)).find(r => String(r.id) === String(cotizacionId))
    if (fresco && String(fresco.vet_id_asignado) === String(vetId)) {
      return { ok: true, ya_aceptada: true, c: fresco, vet }
    }
    return { ok: false, motivo: 'tomada', mensaje: 'Otro veterinario ya tomó esta solicitud. Gracias por tu interés.' }
  }

  // Un vet CONFIRMÓ: la conversación del tutor pasa a 'cliente' (servicio en curso).
  try {
    await marcarConversacionPorTelefono(c.cliente_wa_id || c.cliente_telefono || '', 'cliente', { soloSi: ['activo', 'archivado', 'cerrado'] })
  } catch (e) { console.warn('[eutanasia-aceptar] marcar conversación cliente falló:', e) }

  // Registro del envío de ESE vet → 'aceptada'.
  try {
    await ensureSheet(SHEET_ENVIOS)
    await ensureColumns(SHEET_ENVIOS, COLS_ENVIOS)
    const envios = await getSheetData(SHEET_ENVIOS)
    const envio = envios.find(e => String(e.cotizacion_id) === String(cotizacionId) && String(e.vet_id) === String(vetId))
    if (envio) {
      await updateById(SHEET_ENVIOS, envio.id, { ...envio, estado_envio: 'aceptada', fecha_respuesta: ahora })
    }
  } catch (e) { console.warn('[eutanasia-aceptar] no se pudo actualizar el envío:', e) }

  if (conEfectos) {
    const baseUrl = baseUrlApp()
    // Correo "coordina con la familia" (datos del tutor + botones de cierre).
    try { await enviarCoordinarConFamilia({ c, vet, baseUrl }) } catch (e) { console.warn('[eutanasia-aceptar] correo coordinar falló:', e) }

    // Aviso al TUTOR de que un vet tomó su caso (WhatsApp + correo).
    try {
      await avisarClienteVetConfirmado({ c, vetNombre: vetNombreCompleto, vetTelefono: vet.telefono, baseUrl, vetId: vet.id })
    } catch (e) { console.warn('[eutanasia-aceptar] aviso al cliente falló:', e) }
    if (c.cliente_email) {
      try {
        await enviarClienteVetAsignado({
          clienteEmail: c.cliente_email,
          clienteNombre: c.cliente_nombre,
          mascotaNombre: c.mascota_nombre,
          vetNombre: vetNombreCompleto,
          vetTelefono: vet.telefono || '',
          fechaServicio: formatDate(c.fecha_servicio),
          horaServicio: c.hora_servicio,
        })
      } catch (e) { console.warn('[eutanasia-aceptar] correo al cliente falló:', e) }
    }
  }

  return { ok: true, ya_aceptada: false, c, vet }
}

/** Marca el envío de un vet como rechazado ("no puedo tomarla"). Best-effort. */
export async function rechazarEnvio(cotizacionId: string, vetId: string): Promise<void> {
  try {
    const envios = await getSheetData(SHEET_ENVIOS)
    const envio = envios.find(e => String(e.cotizacion_id) === String(cotizacionId) && String(e.vet_id) === String(vetId))
    if (!envio) return
    await updateById(SHEET_ENVIOS, envio.id, {
      ...envio, estado_envio: 'rechazada', fecha_respuesta: new Date().toISOString(),
    })
  } catch (e) { console.warn('[eutanasia-aceptar] no se pudo marcar el rechazo:', e) }
}
