import { ensureSheet, ensureColumns, appendRow, getNextId, getSheetData, updateById, updateByIdIf } from './datastore'
import { enviarBotonesWhatsapp, destinatariosRetiros, avisarAdminsWhatsapp, enviarMediaWhatsapp, type BotonWa, type EnvioResult } from './whatsapp'
import { crearRelayPendiente } from './relay-retiro'
import { geocodeAddress, coordEnChile } from './google-maps'
import { formatDate, formatDateForSheet, todayISO } from './dates'
import { agregarDiasHabiles, isoFecha, tieneExpress, EXPRESS_DIAS } from './dias-habiles'
import { fmtPrecio } from './format'
import { precioClienteEutanasia, getConsultaEutanasia, getRecargoFueraHorario, recargoEutanasiaPara } from './eutanasia-precios'
import { agendarEutanasiaAutomatico } from './eutanasia-cotizaciones'
import { evaluarSlotRetiro, horaLibreEnFranja } from './agenda'
import { capitalizarNombre } from './nombres'
import { calcularSnapshotFicha } from './price-calculator'
import { dispararCobroAdicional } from './cobros'
import { repartirAnforasPremium } from './anforas-premium'
import { esComunaNoCubierta } from './cobertura'
import { ajustarStockAdicionales } from './stock'
import { generarCatalogoPdf } from './catalogo-generator'
import { uploadToR2 } from './cloudflare-r2'
import { upsertContacto, getOrCreateConversacion, insertarMensaje } from './mensajes'
import type { HandlersAgente, AccionRetiro, AccionReprogramar, AccionRetiroVet, AccionEutanasia, AccionCotizarEutanasia, AccionConsultaEta, AccionConsultaEstado, AccionAgregarAdicional, CtxAgente } from './agente-mensajes'

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

/**
 * Botones de SOLICITUD DE RETIRO a todo el equipo (env + usuarios con avisos ON,
 * incluidos operadores — ver destinatariosRetiros). ok si al menos uno los
 * recibió; la resolución es atómica, así que el primero que toque ✅/❌ gana y el
 * resto recibe el acuse.
 */
async function botonesATodosLosAdmins(body: string, botones: BotonWa[]): Promise<{ ok: boolean; error?: string }> {
  let ok = false
  let error = ''
  for (const num of await destinatariosRetiros()) {
    let env: EnvioResult
    try { env = await enviarBotonesWhatsapp(num, body, botones) } catch (e) { env = { ok: false, error: e instanceof Error ? e.message : String(e) } }
    if (env.ok) ok = true
    else error = env.error || error
  }
  return { ok, error: error || undefined }
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
  if (esComunaNoCubierta(a.comuna)) {
    return `NO registres este retiro: ${a.comuna} está FUERA de nuestra cobertura de retiro a domicilio. Explícaselo al cliente con amabilidad —lamentablemente no llegamos con retiro hasta esa comuna— y ofrécele las alternativas: puede acercar a su mascota a nuestras instalaciones en Recoleta, o lo derivamos al equipo para ver si hay alguna opción. NO agendes.`
  }
  if (!(await direccionValida(a.direccion, a.comuna))) {
    return `No pude validar la dirección "${a.direccion}, ${a.comuna}". Pídele al cliente que la confirme o la corrija (calle y número) y vuelve a registrarla. NO la registres aún.`
  }

  const slot = await evaluarSlotRetiro(a.fecha, a.hora)
  if (!slot.ok) {
    const libres = slot.libres.length ? ` Horarios disponibles ese día: ${slot.libres.join(', ')}.` : ''
    return `NO registres este retiro: ${slot.motivo}${libres} Explícaselo al cliente con amabilidad y ofrécele uno de los horarios disponibles; vuelve a llamar la herramienta solo cuando acuerden una hora válida.`
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

  const env = await botonesATodosLosAdmins(resumen, [
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

/**
 * Cambia la fecha/hora de un retiro YA solicitado (pendiente o confirmado) de
 * este mismo cliente, y avisa al equipo del cambio. Caso real (Guillermo,
 * 2026-07-11): el bot decía "ya le avisé al equipo" sin llamar ninguna
 * herramienta — nadie se enteraba del nuevo horario y el cliente se fue con la
 * competencia. Si ya hay una ficha borrador vinculada, también le actualiza la
 * fecha de retiro (partial update — nunca updateById de fila completa, borraría
 * el resto de la ficha).
 */
async function reprogramarRetiro(a: AccionReprogramar, ctx: CtxAgente): Promise<string> {
  const waCliente = (ctx.waId || '').replace(/\D/g, '')
  const tel9 = waCliente.slice(-9)
  if (!tel9) {
    return 'No pude identificar el WhatsApp del cliente para reprogramar el retiro. Escala a un humano.'
  }

  const slot = await evaluarSlotRetiro(a.fecha, a.hora)
  if (!slot.ok) {
    const libres = slot.libres.length ? ` Horarios disponibles ese día: ${slot.libres.join(', ')}.` : ''
    return `NO reprogrames: ${slot.motivo}${libres} Explícaselo al cliente con amabilidad y ofrécele uno de los horarios disponibles; vuelve a llamar la herramienta solo cuando acuerden una hora válida.`
  }

  await ensureSheet(SHEET_RETIRO)
  await ensureColumns(SHEET_RETIRO, COLS_RETIRO)
  const solicitudes = await getSheetData(SHEET_RETIRO)
  const propias = solicitudes
    .filter(s => ['pendiente', 'confirmada'].includes(s.estado || '') && (s.cliente_wa_id || '').replace(/\D/g, '').slice(-9) === tel9)
    .sort((x, y) => (parseInt(y.id, 10) || 0) - (parseInt(x.id, 10) || 0))
  const sol = propias[0]
  if (!sol) {
    return 'Este cliente no tiene ningún retiro pendiente ni confirmado a su nombre para reprogramar. Si quiere agendar uno nuevo, usa la herramienta solicitar_retiro_cremacion en vez de esta.'
  }

  const fechaAnterior = formatDate(sol.fecha_retiro)
  const horaAnterior = sol.hora_retiro

  await updateByIdIf(SHEET_RETIRO, sol.id, {}, { fecha_retiro: a.fecha, hora_retiro: a.hora })
  if (sol.cliente_id) {
    try { await updateByIdIf('clientes', sol.cliente_id, {}, { fecha_retiro: a.fecha, hora_retiro: a.hora }) }
    catch (e) { console.warn('[agente-acciones] reprogramarRetiro: no se pudo actualizar la ficha:', e) }
  }

  const aviso =
    `🔁 *Retiro reprogramado*\n\n` +
    `Tutor: ${sol.cliente_nombre}\n` +
    `Mascota: ${sol.nombre_mascota}\n` +
    `Dirección: ${sol.direccion}, ${sol.comuna}\n` +
    `Antes: ${fechaAnterior} a las ${horaAnterior}\n` +
    `AHORA: ${formatDate(a.fecha)} a las ${a.hora}\n` +
    (waCliente ? `Cliente: +${waCliente}\n` : '') +
    `\nActualiza la ruta/turno del chofer.`
  try { await avisarAdminsWhatsapp(aviso) } catch (e) { console.warn('[agente-acciones] reprogramarRetiro: no se pudo avisar al admin:', e) }

  return `Listo, retiro reprogramado para el ${formatDate(a.fecha)} a las ${a.hora}. Confírmaselo al cliente con calidez y dile que el equipo ya quedó al tanto del cambio.`
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

  const slot = await evaluarSlotRetiro(a.fecha, a.hora)
  if (!slot.ok) {
    const libres = slot.libres.length ? ` Horarios disponibles ese día: ${slot.libres.join(', ')}.` : ''
    return `NO registres este retiro: ${slot.motivo}${libres} Explícaselo al veterinario y ofrécele uno de los horarios disponibles; vuelve a llamar la herramienta solo cuando acuerden una hora válida.`
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

  const env = await botonesATodosLosAdmins(resumen, [
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

/**
 * Cotiza la eutanasia a domicilio (servicio de EVALUACIÓN). Devuelve los DOS
 * precios de cara al cliente: el de la eutanasia si se realiza (precio al cliente
 * por peso = vet + fijo) y el de la consulta si al evaluar no corresponde.
 */
async function cotizarEutanasia(a: AccionCotizarEutanasia): Promise<string> {
  const peso = Number(a.peso)
  if (!Number.isFinite(peso) || peso <= 0) {
    return 'Necesito el peso aproximado de la mascota para darte el valor de la eutanasia a domicilio.'
  }
  const [{ cliente }, consulta, recargo] = await Promise.all([precioClienteEutanasia(peso), getConsultaEutanasia(), getRecargoFueraHorario()])
  if (cliente <= 0) {
    return 'No tengo el precio de la eutanasia a domicilio configurado para ese peso ahora mismo. Ofrécele que un miembro del equipo lo contacte para darle el valor, o escala a un humano.'
  }
  const notaRecargo = recargo > 0
    ? ` IMPORTANTE: si el servicio queda fuera de horario (fin de semana, feriado o desde las 18:00), se suma un recargo de ${fmtPrecio(recargo)} a ese valor (aplica se realice o no la eutanasia). Avísaselo si la fecha/hora que pide cae fuera de horario, para que no sea una sorpresa.`
    : ''
  return `Es un servicio de EVALUACIÓN a domicilio: un veterinario de la red visita a la mascota y evalúa si corresponde la eutanasia. Explícale al cliente con claridad los dos valores: si SE REALIZA la eutanasia, el valor es ${fmtPrecio(cliente)} (mascota de ${peso} kg); si al evaluar NO corresponde realizarla, se cobra solo la consulta de ${fmtPrecio(consulta.total)}. NO expliques cómo se reparte ese monto internamente.${notaRecargo} Si decide avanzar, junta los datos y agéndala.`
}

/** Crea la cotización de eutanasia, matchea la red de vets y les envía el correo. */
async function agendarEutanasia(a: AccionEutanasia, ctx: CtxAgente): Promise<string> {
  a.nombre_tutor = capitalizarNombre(a.nombre_tutor)
  a.nombre_mascota = capitalizarNombre(a.nombre_mascota)
  // El NOMBRE de la mascota es obligatorio: sin él la ficha y la agenda quedan
  // con "No Especificado" (pasó con la solicitud de Samuel/Daniella). Si el
  // modelo no lo trae o manda un placeholder, NO agendamos: pedimos el nombre.
  const mascotaLimpia = (a.nombre_mascota || '').trim()
  if (!mascotaLimpia || /^(no\s*especificad|sin\s*nombre|desconocid|no\s*s[eé]|n\/?a|xxx|--)/i.test(mascotaLimpia)) {
    return 'Falta el NOMBRE de la mascota para agendar la eutanasia. Pídeselo al cliente de forma cálida ANTES de agendar; nunca uses un placeholder como "No Especificado".'
  }
  const peso = Number(a.peso)
  if (!Number.isFinite(peso) || peso <= 0) {
    return 'Falta el peso de la mascota para agendar la eutanasia. Pídeselo al cliente.'
  }
  if (esComunaNoCubierta(a.comuna)) {
    return `NO agendes esta eutanasia: ${a.comuna} está FUERA de nuestra cobertura de atención a domicilio. Explícaselo al cliente con amabilidad —lamentablemente no llegamos hasta esa comuna— y ofrécele derivarlo al equipo por si hay alguna alternativa. NO agendes.`
  }
  if (!(await direccionValida(a.direccion, a.comuna))) {
    return `No pude validar la dirección "${a.direccion}, ${a.comuna}". Pídele al cliente que la confirme o la corrija (calle y número) y vuelve a agendar. NO la agendes aún.`
  }
  const waCliente = (ctx.waId || '').replace(/\D/g, '')

  // DEDUP DURO: si este número ya tiene una cotización de eutanasia ACTIVA
  // (creada/enviada/aceptada), NO se agenda otra — espejo del dedup de retiros.
  // Caso real (Benito, 2026-07-02): el modelo re-llamó la herramienta "para
  // completar un dato" y duplicó la cotización + los correos a las veterinarias.
  const tel9 = waCliente.slice(-9)
  if (tel9) {
    try {
      const cotis = await getSheetData('cotizaciones_eutanasia')
      const activa = cotis.find(c =>
        ['creada', 'enviada', 'aceptada'].includes(c.estado || '') &&
        (c.cliente_wa_id || c.cliente_telefono || '').replace(/\D/g, '').slice(-9) === tel9
      )
      if (activa) {
        return `Este cliente YA tiene una solicitud de eutanasia ACTIVA (N° ${activa.id}${activa.mascota_nombre ? `, ${activa.mascota_nombre}` : ''}). NO agendes otra. Dile, cálido y breve, que su solicitud ya quedó ingresada y que estamos coordinando con la red de veterinarios; si quiere corregir algún dato, tómalo por mensaje y responde que el equipo lo ajustará.`
      }
    } catch (e) {
      console.warn('[agente-acciones] dedup eutanasia falló (no bloquea):', e)
    }
  }

  // Franja → primera hora LIBRE de esa franja en la agenda (respeta los 45 min
  // con las demás reservas: retiros y otras eutanasias). AM=mañana, PM=tarde.
  const franja = (a.franja || '').toUpperCase() === 'PM' ? 'PM' : 'AM'
  const { hora } = await horaLibreEnFranja(a.fecha, franja)
  if (!hora) {
    const otra = franja === 'PM' ? 'la mañana' : 'la tarde'
    return `NO agendes: la franja de ${franja === 'PM' ? 'la tarde' : 'la mañana'} del ${formatDate(a.fecha)} ya está completa (dejamos al menos 1 hora entre cada servicio agendado). Ofrécele al cliente ${otra} de ese día u otro día, y vuelve a llamar la herramienta cuando elija.`
  }
  const sinCremacion = (a.tipo_servicio_cremacion || '').toUpperCase() === 'NINGUNA'
  const notas = `Solicitud vía WhatsApp (bot). Franja preferida: ${franja === 'PM' ? 'tarde' : 'mañana'}.` +
    (sinCremacion ? ' SIN cremación (el tutor no la quiere).' : (a.tipo_servicio_cremacion ? ` Cremación elegida: ${a.tipo_servicio_cremacion}.` : ''))

  const [{ cliente: precioBase }, recargoMonto] = await Promise.all([precioClienteEutanasia(peso), getRecargoFueraHorario()])
  const recargoFuera = recargoEutanasiaPara(a.fecha, hora, recargoMonto)
  const cliente = precioBase + recargoFuera

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
  const cremTxt = sinCremacion ? 'Cremación: NO (el tutor no la quiere)\n'
    : (a.tipo_servicio_cremacion ? `Cremación: ${a.tipo_servicio_cremacion}\n` : '')
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
  try { await avisarAdminsWhatsapp(avisoAdmin) } catch (e) { console.warn('[agente-acciones] FYI admin eutanasia falló:', e) }

  const precioTxt = cliente > 0
    ? ` El valor del servicio para el cliente es ${fmtPrecio(cliente)}${recargoFuera > 0 ? ` (incluye ${fmtPrecio(recargoFuera)} de recargo por ser fuera de horario, sobre ${fmtPrecio(precioBase)}). Avísale ese recargo con claridad al cliente` : ''}.`
    : ''

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

  // A TODOS los admins; el relay guarda TODOS los message_ids (separados por coma)
  // para que cualquiera pueda responder citando SU copia del aviso.
  const envs = await avisarAdminsWhatsapp(aviso)
  const msgIds = envs.filter(e => e.ok && e.message_id).map(e => String(e.message_id))
  if (msgIds.length === 0) {
    console.warn('[agente-acciones] no se pudo avisar al admin (ETA):', envs.map(e => e.error).filter(Boolean).join('; '))
    return 'Dile al cliente, cálido y breve, que estás confirmando con el equipo el horario de retiro y que en un momento le confirmas por aquí. NO inventes una hora.'
  }
  try {
    await crearRelayPendiente({ adminMsgId: msgIds.join(','), clienteWaId: waCliente, clienteNombre: nombre, mascota, pregunta: 'ETA de retiro' })
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
      const n = parseInt(t?.plazo_entrega_dias || '4', 10)
      const express = tieneExpress(c.adicionales)
      const plazo = express ? EXPRESS_DIAS : (Number.isFinite(n) && n > 0 ? n : 4)
      const isoRetiro = c.fecha_retiro ? formatDateForSheet(c.fecha_retiro) : ''
      if (isoRetiro) {
        const fechaRetiro = new Date(`${isoRetiro}T12:00:00`)
        if (!isNaN(fechaRetiro.getTime())) {
          const obj = agregarDiasHabiles(fechaRetiro, plazo)
          entregaTxt = ` Fecha de entrega MÁXIMA: ${formatDate(isoFecha(obj))} (hasta ${plazo} días HÁBILES desde el retiro${express ? ', con Servicio Express' : ''}; puede ser antes).`
        }
      }
    } catch { /* sin fecha disponible */ }
  }

  return `Datos REALES de la mascota (código ${c.codigo}): nombre "${nombre}", estado: ${estadoLegible}.${entregaTxt} ` +
    `Respóndele al cliente de forma cálida y clara contándole en qué parte del proceso está ${nombre}. ` +
    `Si preguntó por la fecha de entrega, dásela ACLARANDO que es en días hábiles. ` +
    `Usá SOLO estos datos; no inventes fechas ni estados.`
}

/** Busca la ficha del cliente por su WhatsApp (últimos 9 dígitos). Prefiere una
 *  ficha REGISTRADA (con código); si no hay, cae al borrador más reciente. */
async function fichaPorWaId(waId?: string): Promise<Record<string, string> | null> {
  const tel9 = (waId || '').replace(/\D/g, '').slice(-9)
  if (!tel9) return null
  const rows = await getSheetData('clientes')
  const propias = rows.filter(c => (c.telefono || '').replace(/\D/g, '').slice(-9) === tel9)
  if (propias.length === 0) return null
  propias.sort((a, b) => (parseInt(b.id, 10) || 0) - (parseInt(a.id, 10) || 0))
  return propias.find(c => String(c.codigo || '').trim()) || propias[0]
}

/**
 * Envía el catálogo de productos (PDF) al cliente por WhatsApp. Genera el PDF
 * con los datos vigentes, lo sube a R2 y manda el documento.
 */
async function enviarCatalogo(ctx: CtxAgente): Promise<string> {
  const tel9 = (ctx.waId || '').replace(/\D/g, '').slice(-9)
  if (tel9.length !== 9) {
    return 'No pude identificar el WhatsApp del cliente para enviarle el catálogo. Ofrécele que el equipo se lo mande y sigue la conversación.'
  }
  try {
    const pdf = await generarCatalogoPdf()
    const up = await uploadToR2(pdf, 'catalogos/catalogo-productos-alma-animal.pdf', 'application/pdf')
    const env = await enviarMediaWhatsapp(`56${tel9}`, { tipo: 'document', link: up.url, filename: 'Catálogo de productos - Alma Animal.pdf' })
    if (!env.ok) {
      console.warn('[agente-acciones] enviarCatalogo whatsapp falló:', env.error)
      return 'No pude enviar el catálogo en este momento. Dile al cliente que el equipo se lo hará llegar, y continúa la conversación con normalidad.'
    }
    // Registrar el envío en el inbox (queda visible como documento). Best-effort.
    try {
      const cont = await upsertContacto({ wa_id: ctx.waId || `56${tel9}`, telefono: `56${tel9}`, audiencia: 'A' })
      const conv = await getOrCreateConversacion(cont.id, 'whatsapp', cont.audiencia, 'whatsapp')
      await insertarMensaje({
        conversacion_id: conv.id, direccion: 'saliente', cuerpo: 'Catálogo de productos (PDF)',
        tipo: 'documento', media_url: up.url, enviado_por: 'agente', estado: 'enviado',
        provider_message_id: env.message_id ?? null,
      })
    } catch (e) { console.warn('[agente-acciones] no se pudo registrar el catálogo en el inbox:', e) }
    return 'Listo, se le envió el catálogo de productos en PDF al cliente. Acompáñalo con un mensaje breve y cálido invitándolo a revisarlo y a decirte si quiere agregar algo al servicio.'
  } catch (e) {
    console.warn('[agente-acciones] enviarCatalogo error:', e)
    return 'No pude generar el catálogo ahora. Dile al cliente que el equipo se lo enviará a la brevedad.'
  }
}

/**
 * Agrega productos/servicios adicionales a la ficha del cliente (que YA confirmó
 * agregarlos) y dispara el correo + WhatsApp de cobro con los datos de pago.
 * Recalcula el snapshot de la ficha. Requiere una ficha del cliente.
 */
async function agregarAdicional(a: AccionAgregarAdicional, ctx: CtxAgente): Promise<string> {
  const items = Array.isArray(a.items) ? a.items : []
  if (items.length === 0) return 'No indicaste qué producto agregar. Pregúntale al cliente qué quiere agregar y confírmalo antes de llamar esta herramienta.'

  const ficha = await fichaPorWaId(ctx.waId)
  if (!ficha) {
    return 'ESTE CLIENTE AÚN NO TIENE FICHA registrada, así que no puedo agregar el producto a un servicio. NO agregues nada: escala al equipo (escalar_a_humano) para que lo gestionen, y dile al cliente que un miembro del equipo coordinará el adicional.'
  }

  const [prods, otros] = await Promise.all([
    getSheetData('productos').catch(() => [] as Record<string, string>[]),
    getSheetData('otros_servicios').catch(() => [] as Record<string, string>[]),
  ])
  const resueltos: { tipo: 'producto' | 'servicio'; id: string; nombre: string; precio: number; qty: number; categoria?: string }[] = []
  for (const it of items) {
    const tipo = it.tipo === 'servicio' ? 'servicio' : 'producto'
    const fuente = tipo === 'producto' ? prods : otros
    const row = fuente.find(r => String(r.id) === String(it.id))
    if (!row) continue
    resueltos.push({ tipo, id: String(row.id), nombre: row.nombre || '', precio: parseInt(row.precio, 10) || 0, qty: Math.max(1, Number(it.qty) || 1), categoria: row.categoria || '' })
  }
  if (resueltos.length === 0) {
    return 'No reconocí esos productos en el catálogo. Revisa los IDs de la lista PRODUCTOS ADICIONALES DISPONIBLES y vuelve a intentarlo, o escala al equipo.'
  }

  // Agregar a los adicionales existentes de la ficha + recalcular snapshot.
  let adicionales: Array<{ tipo: string; id: string; nombre: string; precio: number; qty: number }> = []
  try { const x = JSON.parse(ficha.adicionales || '[]'); if (Array.isArray(x)) adicionales = x } catch { /* */ }
  for (const r of resueltos) adicionales.push({ tipo: r.tipo, id: r.id, nombre: r.nombre, precio: r.precio, qty: r.qty })

  try {
    const snapshot = await calcularSnapshotFicha({
      peso: parseFloat(ficha.peso_ingreso || ficha.peso_declarado || '0') || 0,
      codigo_servicio: ficha.codigo_servicio || 'CI',
      veterinaria_id: ficha.veterinaria_id || undefined,
      tipo_precios: ficha.tipo_precios || undefined,
      adicionales: adicionales.map(x => ({ tipo: x.tipo as 'producto' | 'servicio', id: x.id, qty: x.qty })),
    })
    await updateById('clientes', String(ficha.id), {
      ...ficha,
      adicionales: JSON.stringify(adicionales),
      precio_servicio: snapshot.precio_servicio,
      precio_adicionales: snapshot.precio_adicionales,
      precio_total: snapshot.precio_total,
    })
  } catch (e) {
    console.warn('[agente-acciones] agregarAdicional: no se pudo actualizar la ficha:', e)
    return 'No pude agregar el producto a la ficha en este momento. Discúlpate brevemente y dile al cliente que el equipo lo coordina en seguida (escala a un humano).'
  }

  // Descontar stock de los productos agregados (los 'servicio' no llevan stock).
  // Antes el bot escribía la ficha directo (sin pasar por el PATCH) y la venta
  // nunca descontaba de Bodega. Best-effort: no bloquea la venta.
  try { await ajustarStockAdicionales([], resueltos.filter(r => r.tipo === 'producto')) }
  catch (e) { console.warn('[agente-acciones] agregarAdicional: stock no ajustado:', e) }

  // Cobro: correo (con datos de transferencia + botón confirmar) + WhatsApp.
  // En Cremación Premium va incluida UNA ánfora premium; las adicionales SÍ se
  // cobran (fuente única: repartirAnforasPremium — misma regla que el snapshot).
  const catMap = new Map(resueltos.filter(r => r.id).map(r => [String(r.id), String(r.categoria || '')]))
  const cobrables = repartirAnforasPremium(ficha.codigo_servicio, resueltos, catMap)
    .filter(r => r.qtyCobrable > 0)
    .map(r => ({ ...r.item, qty: r.qtyCobrable }))
  const monto = cobrables.reduce((s, r) => s + r.precio * r.qty, 0)

  // ¿La ficha ya está REGISTRADA (tiene código = la mascota ya fue retirada/
  // ingresada) o sigue en BORRADOR (aún no la retiran)? Solo se emite el cobro
  // (correo + WhatsApp con datos de transferencia) si YA fue retirada. Si el
  // cliente pide el adicional ANTES del retiro, el producto queda anotado en la
  // ficha (ya lo hicimos arriba) y el CHOFER lo cobra al momento del retiro — NO
  // se envía ningún correo de pago (nos pasó con Mona: se le cobró un relicario
  // antes de retirar a la mascota).
  const fichaRegistrada = (ficha.codigo || '').trim() !== '' && (ficha.estado || '').toLowerCase() !== 'borrador'

  if (cobrables.length > 0 && fichaRegistrada) {
    try {
      await dispararCobroAdicional(
        { id: String(ficha.id), email: ficha.email || '', nombre_tutor: ficha.nombre_tutor || '', nombre_mascota: ficha.nombre_mascota || '', telefono: ficha.telefono || '' },
        cobrables.map(r => ({ nombre: r.nombre, precio: r.precio, qty: r.qty })),
      )
    } catch (e) { console.warn('[agente-acciones] agregarAdicional: cobro falló:', e) }
  }

  const detalle = resueltos.map(r => `${r.qty > 1 ? `${r.qty}× ` : ''}${r.nombre}`).join(', ')
  if (cobrables.length === 0) {
    // Todo lo agregado venía incluido gratis (ej. ánfora premium de una Cremación
    // Premium): no se cobró nada, así que NO se envió correo de pago.
    return `Listo: agregué ${detalle} al servicio de ${ficha.nombre_mascota || 'la mascota'}, sin costo adicional (viene incluido en el servicio). ` +
      `Confírmale de forma cálida y breve que quedó agregado, sin necesidad de pago adicional.`
  }
  if (!fichaRegistrada) {
    // Mascota todavía NO retirada: se anotó en la ficha, se cobra al retirar.
    return `Listo: agregué ${detalle} al servicio de ${ficha.nombre_mascota || 'la mascota'} (${fmtPrecio(monto)}). ` +
      `Como la mascota TODAVÍA NO ha sido retirada, quedó anotado en su ficha y NO enviamos ningún cobro por ahora: el pago se coordina al momento del retiro. ` +
      `Confírmale de forma cálida y breve que quedó agregado y que se cobra al momento del retiro (NO le digas que le llegará un correo con datos de pago).`
  }
  return `Listo: agregué ${detalle} al servicio de ${ficha.nombre_mascota || 'la mascota'} (total a pagar ${fmtPrecio(monto)}). ` +
    `Le enviamos al cliente un correo con el detalle y los datos de transferencia (y un aviso por WhatsApp). ` +
    `Confírmale de forma cálida y breve que quedó agregado y que le llegó el correo con los datos para pagar.`
}

/** Handlers disponibles para el agente (Flujo A: retiro · Flujo B: eutanasia). */
export function handlersAgente(): HandlersAgente {
  return { solicitarRetiro, reprogramarRetiro, solicitarRetiroVet, cotizarEutanasia, agendarEutanasia, consultarEtaRetiro, consultarEstadoMascota, enviarCatalogo, agregarAdicional }
}
