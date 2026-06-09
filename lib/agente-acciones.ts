import { ensureSheet, ensureColumns, appendRow, getNextId } from './datastore'
import { enviarBotonesWhatsapp, enviarTextoWhatsapp, adminWhatsapp } from './whatsapp'
import { geocodeAddress, coordEnChile } from './google-maps'
import { formatDate, todayISO } from './dates'
import { fmtPrecio } from './format'
import { precioClienteEutanasia } from './eutanasia-precios'
import { agendarEutanasiaAutomatico } from './eutanasia-cotizaciones'
import type { HandlersAgente, AccionRetiro, AccionEutanasia, AccionCotizarEutanasia, CtxAgente } from './agente-mensajes'

/**
 * Valida que una dirección + comuna exista y caiga dentro de Chile (geocoding).
 * Best-effort: si Google Maps no está configurado o la llamada falla, NO bloquea
 * (devuelve true) para no romper el agendamiento por un problema de infraestructura.
 */
async function direccionValida(direccion: string, comuna: string): Promise<boolean> {
  if (!process.env.GOOGLE_MAPS_API_KEY) return true
  try {
    const geo = await geocodeAddress(`${direccion}, ${comuna}, Región Metropolitana, Chile`)
    if (!geo) return false
    return coordEnChile({ lat: geo.lat, lng: geo.lng })
  } catch (e) {
    console.warn('[agente-acciones] geocoding falló (no bloquea):', e)
    return true
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Handlers de las herramientas del agente de WhatsApp (tool-use). El webhook los
// inyecta en generarRespuesta(); solo se le ofrecen al modelo las acciones que
// tienen handler aquí.
//
//  - solicitarRetiro  (Flujo A): registra la solicitud y avisa al admin con
//    botones ✅/❌. La confirmación/rechazo la procesa el webhook al recibir el
//    button_reply (ver procesarBotonAdmin en app/api/mensajes/webhook).
//  - agendarEutanasia (Flujo B): se implementa en la fase 5.
// ─────────────────────────────────────────────────────────────────────────────

const SHEET_RETIRO = 'solicitudes_retiro'
const COLS_RETIRO = [
  'id', 'cliente_wa_id', 'cliente_nombre', 'nombre_mascota',
  'peso', 'direccion', 'comuna', 'fecha_retiro', 'hora_retiro', 'tipo_servicio',
  'estado', 'fecha_creacion', 'fecha_resolucion',
]

async function solicitarRetiro(a: AccionRetiro, ctx: CtxAgente): Promise<string> {
  if (!(await direccionValida(a.direccion, a.comuna))) {
    return `No pude validar la dirección "${a.direccion}, ${a.comuna}". Pídele al cliente que la confirme o la corrija (calle y número) y vuelve a registrarla. NO la registres aún.`
  }

  await ensureSheet(SHEET_RETIRO)
  await ensureColumns(SHEET_RETIRO, COLS_RETIRO)

  const waCliente = (ctx.waId || '').replace(/\D/g, '')
  const id = await getNextId(SHEET_RETIRO)
  await appendRow(SHEET_RETIRO, {
    id,
    cliente_wa_id: waCliente,
    cliente_nombre: a.nombre_tutor,
    nombre_mascota: a.nombre_mascota,
    peso: a.peso,
    direccion: a.direccion,
    comuna: a.comuna,
    fecha_retiro: a.fecha,
    hora_retiro: a.hora,
    tipo_servicio: a.tipo_servicio ?? '',
    estado: 'pendiente',
    fecha_creacion: todayISO(),
    fecha_resolucion: '',
  })

  const resumen =
    `🐾 *Nueva solicitud de retiro*\n\n` +
    `Tutor: ${a.nombre_tutor}\n` +
    `Mascota: ${a.nombre_mascota} (${a.peso} kg)\n` +
    `Dirección: ${a.direccion}, ${a.comuna}\n` +
    `Fecha: ${formatDate(a.fecha)} a las ${a.hora}\n` +
    (a.tipo_servicio ? `Servicio: ${a.tipo_servicio}\n` : '') +
    (waCliente ? `Cliente: +${waCliente}\n` : '') +
    `\n¿Confirmas este retiro?`

  const env = await enviarBotonesWhatsapp(adminWhatsapp(), resumen, [
    { id: `retiro_ok:${id}`, title: '✅ Confirmar' },
    { id: `retiro_no:${id}`, title: '❌ Rechazar' },
  ])

  if (!env.ok) {
    console.warn('[agente-acciones] no se pudo avisar al admin:', env.error)
    return `La solicitud quedó registrada (N° ${id}) pero no pude avisar al equipo automáticamente. Dile al cliente que su solicitud fue recibida y que le confirmaremos a la brevedad.`
  }

  return `Solicitud de retiro registrada (N° ${id}) y enviada al equipo para confirmación. ` +
    `Confirma al cliente que RECIBIMOS su solicitud para el ${formatDate(a.fecha)} a las ${a.hora} y que le avisaremos por este mismo medio apenas la validemos. ` +
    `NO le digas que ya está confirmada.`
}

// ─── Flujo B: eutanasia a domicilio ──────────────────────────────────────────

/** Cotiza el precio AL CLIENTE de la eutanasia (precio del vet + fijo). */
async function cotizarEutanasia(a: AccionCotizarEutanasia): Promise<string> {
  const peso = Number(a.peso)
  if (!Number.isFinite(peso) || peso <= 0) {
    return 'Necesito el peso aproximado de la mascota para darte el valor de la eutanasia a domicilio.'
  }
  const { cliente } = await precioClienteEutanasia(peso)
  if (cliente <= 0) {
    return 'No tengo el precio de la eutanasia a domicilio configurado para ese peso ahora mismo. Ofrécele que un miembro del equipo lo contacte para darle el valor, o escala a un humano.'
  }
  return `El servicio de eutanasia a domicilio para una mascota de ${peso} kg tiene un valor para el cliente de ${fmtPrecio(cliente)}. Comunícale ese valor con claridad. Si decide avanzar, junta los datos y agéndala.`
}

/** Crea la cotización de eutanasia, matchea la red de vets y les envía el correo. */
async function agendarEutanasia(a: AccionEutanasia, ctx: CtxAgente): Promise<string> {
  const peso = Number(a.peso)
  if (!Number.isFinite(peso) || peso <= 0) {
    return 'Falta el peso de la mascota para agendar la eutanasia. Pídeselo al cliente.'
  }
  if (!(await direccionValida(a.direccion, a.comuna))) {
    return `No pude validar la dirección "${a.direccion}, ${a.comuna}". Pídele al cliente que la confirme o la corrija (calle y número) y vuelve a agendar. NO la agendes aún.`
  }
  const waCliente = (ctx.waId || '').replace(/\D/g, '')
  // Franja → hora representativa para el matcher (AM=mañana, PM=tarde).
  const franja = (a.franja || '').toUpperCase() === 'PM' ? 'PM' : 'AM'
  const hora = franja === 'PM' ? '16:00' : '10:00'
  const notas = `Solicitud vía WhatsApp (bot). Franja preferida: ${franja === 'PM' ? 'tarde' : 'mañana'}.` +
    (a.tipo_servicio_cremacion ? ` Cremación elegida: ${a.tipo_servicio_cremacion}.` : '')

  const { cliente } = await precioClienteEutanasia(peso)

  let res
  try {
    res = await agendarEutanasiaAutomatico({
      mascota_nombre: a.nombre_mascota,
      especie: a.especie,
      peso,
      cliente_nombre: a.nombre_tutor,
      cliente_telefono: waCliente,
      cliente_email: a.email,
      cliente_wa_id: waCliente,
      direccion: a.direccion,
      comuna: a.comuna,
      fecha: a.fecha,
      hora,
      tipo_servicio_cremacion: a.tipo_servicio_cremacion,
      notas,
    })
  } catch (e) {
    console.error('[agente-acciones] agendarEutanasia:', e)
    return 'No pude completar el agendamiento de la eutanasia. Discúlpate brevemente y dile al cliente que un miembro del equipo lo contactará a la brevedad.'
  }

  // Avisar al admin (FYI, sin botones): la eutanasia no requiere su confirmación,
  // se busca vet en paralelo. Best-effort.
  const cremTxt = a.tipo_servicio_cremacion ? `Cremación: ${a.tipo_servicio_cremacion}\n` : ''
  const avisoAdmin =
    `🐾 *Nueva solicitud de EUTANASIA a domicilio* (N° ${res.id})\n\n` +
    `Tutor: ${a.nombre_tutor}\n` +
    `Mascota: ${a.nombre_mascota} (${a.especie}, ${peso} kg)\n` +
    `Dirección: ${a.direccion}, ${res.comunaCanon}\n` +
    `Fecha: ${formatDate(a.fecha)} · ${franja === 'PM' ? 'tarde' : 'mañana'}\n` +
    cremTxt +
    (waCliente ? `Cliente: +${waCliente}` : '') + (a.email ? ` · ${a.email}\n` : '\n') +
    (res.matched > 0
      ? `Se envió a ${res.enviados} veterinario${res.enviados === 1 ? '' : 's'} de la red en ${res.comunaCanon}.`
      : `⚠ Sin veterinarios disponibles para ${res.comunaCanon} en esa fecha/franja — requiere gestión manual.`)
  try { await enviarTextoWhatsapp(adminWhatsapp(), avisoAdmin) } catch (e) { console.warn('[agente-acciones] FYI admin eutanasia falló:', e) }

  const precioTxt = cliente > 0 ? ` El valor del servicio para el cliente es ${fmtPrecio(cliente)}.` : ''

  if (res.matched === 0) {
    return `Registré la solicitud de eutanasia (N° ${res.id}) pero ahora mismo no hay veterinarios disponibles para ${res.comunaCanon} en esa fecha/franja. ` +
      `Dile al cliente que su solicitud quedó INGRESADA y que el equipo lo contactará a la brevedad para coordinar.${precioTxt}`
  }
  return `Solicitud de eutanasia registrada (N° ${res.id}) y enviada a ${res.enviados} veterinario${res.enviados === 1 ? '' : 's'} de nuestra red en ${res.comunaCanon}. ` +
    `Dile al cliente que su solicitud quedó INGRESADA y que nos pondremos en contacto por este mismo medio apenas un veterinario confirme su disponibilidad.${precioTxt}`
}

/** Handlers disponibles para el agente (Flujo A: retiro · Flujo B: eutanasia). */
export function handlersAgente(): HandlersAgente {
  return { solicitarRetiro, cotizarEutanasia, agendarEutanasia }
}
