import { ensureSheet, ensureColumns, appendRow, getNextId, getSheetData } from './datastore'
import { enviarBotonesWhatsapp, enviarTextoWhatsapp, adminWhatsapp } from './whatsapp'
import { crearRelayPendiente } from './relay-retiro'
import { geocodeAddress, coordEnChile } from './google-maps'
import { formatDate, formatDateForSheet, todayISO } from './dates'
import { agregarDiasHabiles, isoFecha } from './dias-habiles'
import { fmtPrecio } from './format'
import { precioClienteEutanasia } from './eutanasia-precios'
import { agendarEutanasiaAutomatico } from './eutanasia-cotizaciones'
import { capitalizarNombre } from './nombres'
import type { HandlersAgente, AccionRetiro, AccionRetiroVet, AccionEutanasia, AccionCotizarEutanasia, AccionConsultaEta, AccionConsultaEstado, CtxAgente } from './agente-mensajes'

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
  'origen', 'veterinaria_id', 'vet_nombre', 'vet_email',
]

async function solicitarRetiro(a: AccionRetiro, ctx: CtxAgente): Promise<string> {
  a.nombre_tutor = capitalizarNombre(a.nombre_tutor)
  a.nombre_mascota = capitalizarNombre(a.nombre_mascota)
  if (!(await direccionValida(a.direccion, a.comuna))) {
    return `No pude validar la dirección "${a.direccion}, ${a.comuna}". Pídele al cliente que la confirme o la corrija (calle y número) y vuelve a registrarla. NO la registres aún.`
  }

  await ensureSheet(SHEET_RETIRO)
  await ensureColumns(SHEET_RETIRO, COLS_RETIRO)

  const waCliente = (ctx.waId || '').replace(/\D/g, '')

  // No permitir una SEGUNDA solicitud si el cliente YA tiene una ficha de retiro
  // en proceso. La fuente de verdad es lo VISIBLE en /clientes (ficha "borrador"/
  // por ingresar), no el log interno: así, cuando el equipo la registra o la
  // elimina, el cliente puede volver a pedir.
  const tel9 = waCliente.slice(-9)
  const clientes = await getSheetData('clientes')
  const enProceso = clientes.find(c => c.estado === 'borrador' && (c.telefono || '').replace(/\D/g, '').slice(-9) === tel9)
  if (enProceso) {
    return `Este cliente YA tiene una solicitud de retiro EN PROCESO${enProceso.nombre_mascota ? ` (${enProceso.nombre_mascota})` : ''}, que el equipo está terminando de ingresar. NO registres otra. Dile, cálido y breve, que su solicitud ya está en proceso y que la estamos gestionando; si necesita cambiar algún dato, que nos lo indique.`
  }

  // El borrador recién existe cuando el admin CONFIRMA. Entre la solicitud y ese
  // ✅, un 2º "agéndame" no vería borrador → se duplicaría la solicitud. Por eso
  // también bloqueamos si ya hay una solicitud PENDIENTE de este mismo cliente.
  const solicitudesPrevias = await getSheetData(SHEET_RETIRO)
  const pendientePrevia = solicitudesPrevias.find(
    s => s.estado === 'pendiente' && (s.cliente_wa_id || '').replace(/\D/g, '').slice(-9) === tel9
  )
  if (pendientePrevia) {
    return `Este cliente YA tiene una solicitud de retiro PENDIENTE de confirmación${pendientePrevia.nombre_mascota ? ` (${pendientePrevia.nombre_mascota})` : ''}. NO registres otra. Dile, cálido y breve, que ya recibimos su solicitud y la estamos confirmando; si necesita cambiar algún dato, que nos lo indique.`
  }

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

// ─── Flujo A-vet: retiro originado por un veterinario de convenio ─────────────

/** Normaliza un nombre para comparar (minúsculas, sin tildes ni puntuación). */
function normalizaNombre(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Busca un veterinario de convenio ACTIVO por nombre (match flexible). */
async function buscarVetConvenio(nombre: string): Promise<{ unico?: Record<string, string>; varios?: Record<string, string>[] }> {
  const q = normalizaNombre(nombre)
  if (q.length < 3) return {}
  const vets = (await getSheetData('veterinarios')).filter(v => /^(true|verdadero|1)$/i.test((v.activo || '').trim()))
  const exactos = vets.filter(v => normalizaNombre(v.nombre) === q)
  if (exactos.length === 1) return { unico: exactos[0] }
  if (exactos.length > 1) return { varios: exactos }
  const parciales = vets.filter(v => {
    const n = normalizaNombre(v.nombre)
    return n.length >= 3 && (n.includes(q) || q.includes(n))
  })
  if (parciales.length === 1) return { unico: parciales[0] }
  if (parciales.length > 1) return { varios: parciales }
  return {}
}

/**
 * Handler del retiro originado por un VETERINARIO de convenio. Identifica al vet
 * por NOMBRE en la hoja `veterinarios` (activos); si no lo encuentra, NO agenda y
 * pide escalar. Si lo encuentra, registra la solicitud asociada al vet (origen
 * 'bot_vet') y avisa al admin con botones ✅/❌. NO aplica el bloqueo de "una sola
 * ficha en proceso" (un vet agenda muchos retiros distintos).
 */
async function solicitarRetiroVet(a: AccionRetiroVet, ctx: CtxAgente): Promise<string> {
  a.nombre_mascota = capitalizarNombre(a.nombre_mascota)
  const { unico, varios } = await buscarVetConvenio(a.veterinaria_nombre)
  if (varios && varios.length > 1) {
    const nombres = varios.slice(0, 4).map(v => v.nombre).filter(Boolean).join(', ')
    return `Hay varios veterinarios en la base que coinciden con "${a.veterinaria_nombre}" (${nombres}). Pídele al veterinario que indique el nombre exacto de su clínica para identificarlo bien. NO agendes todavía.`
  }
  if (!unico) {
    return `No encontré al veterinario "${a.veterinaria_nombre}" en nuestra base de convenio. NO agendes el retiro. Usa la herramienta escalar_a_humano explicando que un veterinario quiere agendar un retiro y no pudimos identificarlo en la base, y dile al veterinario —cálido y breve— que un miembro del equipo lo contactará en seguida para coordinar.`
  }

  if (!(await direccionValida(a.direccion, a.comuna))) {
    return `No pude validar la dirección "${a.direccion}, ${a.comuna}". Pídele al veterinario que la confirme o la corrija (calle y número) y vuelve a registrarla. NO la registres aún.`
  }

  await ensureSheet(SHEET_RETIRO)
  await ensureColumns(SHEET_RETIRO, COLS_RETIRO)

  const waVet = (ctx.waId || '').replace(/\D/g, '')
  const id = await getNextId(SHEET_RETIRO)
  await appendRow(SHEET_RETIRO, {
    id,
    cliente_wa_id: waVet,
    cliente_nombre: unico.nombre || a.veterinaria_nombre,
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
    origen: 'bot_vet',
    veterinaria_id: unico.id || '',
    vet_nombre: unico.nombre || '',
    vet_email: unico.correo || '',
  })

  const resumen =
    `🐾 *Nueva solicitud de retiro (VETERINARIO)*\n\n` +
    `Veterinario: ${unico.nombre || a.veterinaria_nombre}\n` +
    `Mascota: ${a.nombre_mascota} (${a.peso} kg)\n` +
    `Dirección: ${a.direccion}, ${a.comuna}\n` +
    `Fecha: ${formatDate(a.fecha)} a las ${a.hora}\n` +
    (a.tipo_servicio ? `Servicio: ${a.tipo_servicio}\n` : '') +
    (waVet ? `Contacto: +${waVet}\n` : '') +
    `\n¿Confirmas este retiro?`

  const env = await enviarBotonesWhatsapp(adminWhatsapp(), resumen, [
    { id: `retiro_ok:${id}`, title: '✅ Confirmar' },
    { id: `retiro_no:${id}`, title: '❌ Rechazar' },
  ])

  if (!env.ok) {
    console.warn('[agente-acciones] no se pudo avisar al admin (vet):', env.error)
    return `La solicitud quedó registrada (N° ${id}) pero no pude avisar al equipo automáticamente. Dile al veterinario que su solicitud fue recibida y que le confirmaremos a la brevedad.`
  }

  return `Solicitud de retiro registrada (N° ${id}) para el veterinario ${unico.nombre || a.veterinaria_nombre} y enviada al equipo para confirmación. ` +
    `Confirma al veterinario que RECIBIMOS la solicitud de retiro de ${a.nombre_mascota} para el ${formatDate(a.fecha)} a las ${a.hora} y que le avisaremos apenas la validemos. ` +
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
  a.nombre_tutor = capitalizarNombre(a.nombre_tutor)
  a.nombre_mascota = capitalizarNombre(a.nombre_mascota)
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

/**
 * Consulta "¿cuánto falta para el retiro?": avisa al admin (pidiéndole que
 * responda CITANDO el mensaje) y guarda el relay pendiente. Cuando el admin
 * responde, el webhook reenvía su respuesta al cliente. NO inventa una hora.
 */
async function consultarEtaRetiro(a: AccionConsultaEta, ctx: CtxAgente): Promise<string> {
  const waCliente = (ctx.waId || '').replace(/\D/g, '')
  if (!waCliente) {
    return 'Dile al cliente que estás confirmando con el equipo cuánto falta para el retiro y que en un momento le confirmas por aquí.'
  }
  let mascota = capitalizarNombre(a.mascota_nombre || '')
  let fechaTxt = ''
  try {
    const rows = await getSheetData(SHEET_RETIRO)
    const propias = rows.filter(r => (r.cliente_wa_id || '').replace(/\D/g, '') === waCliente)
    const ref = propias.find(r => r.estado === 'confirmada') || propias.find(r => r.estado === 'pendiente')
    if (ref) {
      if (!mascota) mascota = ref.nombre_mascota || ''
      if (ref.fecha_retiro) fechaTxt = ` (agendado ${formatDate(ref.fecha_retiro)}${ref.hora_retiro ? ' ' + ref.hora_retiro : ''})`
    }
  } catch { /* contexto opcional */ }

  const nombre = ctx.nombreContacto || ''
  const aviso =
    `⏱️ *Consulta de horario de retiro*\n\n` +
    (nombre ? `Cliente: ${nombre}\n` : '') +
    `WhatsApp: +${waCliente}\n` +
    (mascota ? `Mascota: ${mascota}${fechaTxt}\n` : '') +
    `\nPregunta cuánto falta para que pasen a retirar.\n` +
    `👉 Respóndeme por aquí con la hora/estado estimado y le escribo al cliente con tus palabras. ` +
    `(Si tienes varias consultas abiertas a la vez, responde citando la que corresponde.)`

  const env = await enviarTextoWhatsapp(adminWhatsapp(), aviso)
  if (!env.ok || !env.message_id) {
    console.warn('[agente-acciones] no se pudo avisar al admin (ETA):', env.error)
    return 'Dile al cliente, cálido y breve, que estás confirmando con el equipo el horario de retiro y que en un momento le confirmas por aquí. NO inventes una hora.'
  }
  try {
    await crearRelayPendiente({ adminMsgId: env.message_id, clienteWaId: waCliente, clienteNombre: nombre, mascota, pregunta: 'ETA de retiro' })
  } catch (e) { console.warn('[agente-acciones] no se pudo guardar relay pendiente:', e) }

  return 'Avisé al equipo para que confirme el horario. Dile al cliente, cálido y breve, que estás confirmando cuánto falta para el retiro y que apenas el equipo responda se lo avisas por aquí. NO inventes una hora.'
}

/**
 * Estado de una mascota por CÓDIGO: en qué parte del proceso está + la fecha de
 * entrega MÁXIMA (en días hábiles, igual que el calendario de Despachos:
 * fecha_retiro + plazo_entrega_dias del tipo de servicio). Solo lee la ficha; no
 * inventa nada. Si no encuentra el código, pide verificarlo / escalar.
 */
async function consultarEstadoMascota(a: AccionConsultaEstado): Promise<string> {
  const codigo = (a.codigo || '').trim()
  if (!codigo) {
    return 'Pídele al cliente el CÓDIGO de su mascota (lo recibió en el correo de registro/bienvenida, formato tipo P130-CI) y vuelve a consultar. NO inventes el estado.'
  }
  const norm = (s: string) => (s || '').trim().toUpperCase().replace(/\s+/g, '')
  const clientes = await getSheetData('clientes')
  const c = clientes.find(x => norm(x.codigo) === norm(codigo))
  if (!c) {
    return `No encontré ninguna mascota con el código "${codigo}". Pídele al cliente que lo verifique (está en el correo de registro/bienvenida, formato tipo P130-CI). Si insiste en que es correcto, ofrécele que lo revise el equipo (escala a un humano). NO inventes un estado.`
  }

  const nombre = c.nombre_mascota || 'la mascota'
  const estado = (c.estado || 'pendiente').toLowerCase()
  const codigoServ = (c.codigo_servicio || 'CI').toUpperCase()

  let estadoLegible: string
  if (estado === 'despachado') estadoLegible = 'YA ENTREGADA — el ánfora ya fue entregada al tutor'
  else if (estado === 'cremado') estadoLegible = 'CREMACIÓN LISTA — estamos coordinando la entrega'
  else if (estado === 'borrador') estadoLegible = 'EN INGRESO — el equipo está terminando de registrar la ficha'
  else estadoLegible = 'EN PROCESO de cremación — ya la recibimos y está en proceso'

  // Fecha de entrega MÁXIMA (días hábiles). No aplica a Sin Devolución (no hay
  // entrega) ni a fichas ya despachadas o en borrador (sin fecha de retiro firme).
  let entregaTxt = ''
  if (codigoServ === 'SD') {
    entregaTxt = ' Es una Cremación Sin Devolución: no hay entrega de ánfora.'
  } else if (estado !== 'despachado' && estado !== 'borrador') {
    try {
      const tipos = await getSheetData('tipos_servicio')
      const t = tipos.find(x => (x.codigo || '').toUpperCase() === codigoServ)
      const n = parseInt(t?.plazo_entrega_dias || '3', 10)
      const plazo = Number.isFinite(n) && n > 0 ? n : 3
      const isoRetiro = c.fecha_retiro ? formatDateForSheet(c.fecha_retiro) : ''
      if (isoRetiro) {
        const fechaRetiro = new Date(`${isoRetiro}T12:00:00`)
        if (!isNaN(fechaRetiro.getTime())) {
          const obj = agregarDiasHabiles(fechaRetiro, plazo)
          entregaTxt = ` Fecha de entrega MÁXIMA: ${formatDate(isoFecha(obj))} (hasta ${plazo} días HÁBILES desde el retiro; puede ser antes).`
        }
      }
    } catch { /* sin fecha disponible */ }
  }

  return `Datos REALES de la mascota (código ${c.codigo}): nombre "${nombre}", estado: ${estadoLegible}.${entregaTxt} ` +
    `Respóndele al cliente de forma cálida y clara contándole en qué parte del proceso está ${nombre}. ` +
    `Si preguntó por la fecha de entrega, dásela ACLARANDO que es en días hábiles. ` +
    `Usá SOLO estos datos; no inventes fechas ni estados.`
}

/** Handlers disponibles para el agente (Flujo A: retiro · Flujo B: eutanasia). */
export function handlersAgente(): HandlersAgente {
  return { solicitarRetiro, solicitarRetiroVet, cotizarEutanasia, agendarEutanasia, consultarEtaRetiro, consultarEstadoMascota }
}
