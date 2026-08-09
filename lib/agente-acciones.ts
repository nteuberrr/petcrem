import { ensureSheet, ensureColumns, appendRow, getNextId, getSheetData, updateById, updateByIdIf, deleteById } from './datastore'
import { enviarBotonesWhatsapp, enviarPlantillaBotonesWhatsapp, enviarPlantillaWhatsapp, destinatariosRetiros, avisarAdminsWhatsapp, enviarMediaWhatsapp, type BotonWa, type EnvioResult } from './whatsapp'
import { crearRelayPendiente } from './relay-retiro'
import { geocodeAddress, coordEnChile } from './google-maps'
import { formatDate, formatDateConDia, formatDateForSheet, fechaChileISO } from './dates'
import { agregarDiasHabiles, isoFecha, tieneExpress, EXPRESS_DIAS } from './dias-habiles'
import { fmtPrecio } from './format'
import { precioClienteEutanasia, getConsultaEutanasia, getRecargoFueraHorario, recargoEutanasiaPara } from './eutanasia-precios'
import { agendarEutanasiaAutomatico } from './eutanasia-cotizaciones'
import { sincronizarFichaDeEutanasia } from './eutanasia-sync'
import { enviarVetCambioFechaEutanasia } from './eutanasia-mailer'
import { evaluarSlotRetiro, evaluarHoraEutanasia, horaLibreEnFranja, ahoraChile, retiroTrasEutanasia, proximoRetiroPosible, type RetiroTrasEutanasia } from './agenda'
import { capitalizarNombre } from './nombres'
import { calcularSnapshotFicha } from './price-calculator'
import { dispararCobroAdicional, correspondeCobrarAdicional } from './cobros'
import { repartirAnforasPremium } from './anforas-premium'
import { esComunaNoCubierta } from './cobertura'
import { findTramo, precioDelTramo } from './tramos'
import { aplicaReglaAuto, cremacionLlevaRecargoFueraHorario } from './adicionales-auto'
import { ajustarStockAdicionales } from './stock'
import { generarCatalogoPdf } from './catalogo-generator'
import { uploadToR2 } from './cloudflare-r2'
import { upsertContacto, getOrCreateConversacion, insertarMensaje } from './mensajes'
import type { HandlersAgente, AccionRetiro, AccionReprogramar, AccionRetiroVet, AccionEutanasia, AccionCotizarEutanasia, AccionCotizarCremacion, AccionConsultaEta, AccionConsultaEstado, AccionAgregarAdicional, AccionCancelar, CtxAgente } from './agente-mensajes'

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

/** Datos del aviso de retiro, en las dos formas que puede salir (libre / plantilla). */
interface AvisoRetiro {
  /** Cuerpo del mensaje interactivo: multilínea y con formato. */
  resumen: string
  /** Variables de `solicitud_retiro`: quién pide, mascota, dirección, cuándo, contacto. */
  vars: [string, string, string, string, string]
  botones: BotonWa[]
}

/**
 * Arma las 5 variables de la plantilla `solicitud_retiro` desde los datos crudos.
 * NINGUNA puede quedar vacía: Meta rechaza el envío si un parámetro llega en
 * blanco, y ahí se caería el único aviso que le queda al equipo.
 */
function varsPlantillaRetiro(d: {
  quien: string; mascota: string; peso: string | number
  direccion: string; comuna: string; fecha: string; hora: string; contacto: string
}): [string, string, string, string, string] {
  const oSino = (v: string, alt: string) => String(v || '').trim() || alt
  const peso = String(d.peso ?? '').trim()
  return [
    oSino(d.quien, 'Sin nombre'),
    `${oSino(d.mascota, 'Sin nombre')}${peso ? ` (${peso} kg)` : ''}`,
    oSino([d.direccion, d.comuna].filter(Boolean).join(', '), 'Sin dirección'),
    oSino(`${formatDate(d.fecha)} a las ${d.hora}`, 'Por coordinar'),
    d.contacto ? `+${d.contacto}` : 'Sin número',
  ]
}

/**
 * Aviso de SOLICITUD DE RETIRO a todo el equipo (env + usuarios con avisos ON,
 * incluidos operadores — ver destinatariosRetiros), con los botones ✅/❌ para
 * resolverla sin salir de WhatsApp. ok si al menos uno lo recibió; la resolución
 * es atómica, así que el primero que toque un botón gana y el resto recibe el acuse.
 *
 * Baja por TRES escalones, porque un mensaje `interactive` solo se entrega dentro
 * de la ventana de 24h de Meta… y esa ventana la abría justamente el botón que no
 * llegaba: bastó UN día sin retiros para que la cadena se cortara y el aviso
 * quedara mudo sin que nadie se enterara (caso real 09-08-2026, tres solicitudes
 * seguidas sin un solo WhatsApp).
 *   1. interactivo — gratis, el camino normal dentro de la ventana;
 *   2. plantilla `solicitud_retiro` CON botones — se entrega siempre y sigue
 *      siendo accionable; cuesta como utility;
 *   3. plantilla `aviso_operativo` en texto — si la 2 todavía no está aprobada en
 *      Meta, al menos el equipo se entera y lo resuelve desde el panel.
 *
 * El escalón 2 se intenta a ciegas en vez de consultar `plantillasAprobadas()`:
 * ese chequeo necesita `WHATSAPP_BUSINESS_ACCOUNT_ID` y, si faltara, degradaría
 * todos los avisos a texto sin botones sin motivo.
 */
async function avisarRetiroAlEquipo(av: AvisoRetiro): Promise<{ ok: boolean; error?: string }> {
  let ok = false
  let error = ''
  const intentar = async (fn: () => Promise<EnvioResult>): Promise<EnvioResult> => {
    try { return await fn() } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
  }
  for (const num of await destinatariosRetiros()) {
    let env = await intentar(() => enviarBotonesWhatsapp(num, av.resumen, av.botones))
    if (!env.ok && env.fuera_de_ventana) {
      env = await intentar(() => enviarPlantillaBotonesWhatsapp(num, 'solicitud_retiro', av.vars, av.botones.map(b => b.id)))
      if (!env.ok) {
        env = await intentar(() => enviarPlantillaWhatsapp(num, 'aviso_operativo', [`${av.resumen} — Confírmalo en el panel del dashboard`]))
      }
    }
    if (env.ok) ok = true
    else error = env.error || error
  }
  // Que NADIE se haya enterado es grave: el retiro queda comprometido con el
  // cliente y esperando en el panel. Va como error, no como warning.
  if (!ok) console.error('[agente-acciones] ⚠ el aviso de retiro no llegó a NINGÚN número del equipo:', error)
  return { ok, error: error || undefined }
}

/**
 * Cierra la carrera de la SOLICITUD DUPLICADA (defensa en profundidad).
 *
 * Los guards de "este cliente ya tiene una solicitud pendiente" se hacen con un
 * SELECT antes del INSERT: si dos turnos del agente corren en paralelo (pasaba
 * cuando el cliente mandaba dos mensajes casi juntos — ver el debounce del
 * webhook), ninguno ve la fila del otro y ambos agendan. Caso real 2026-07-28:
 * solicitudes #57 y #58, mismo tutor, misma mascota, misma hora, dos avisos al
 * equipo.
 *
 * Por eso, DESPUÉS de insertar, releemos y comparamos ids: si existe una
 * solicitud rival con id MENOR, esta perdió la carrera → se anula (estado
 * 'duplicada', solo si sigue pendiente) y el caller no avisa al equipo. Devuelve
 * el id de la solicitud ganadora, o null si esta es la válida.
 */
async function anularSiDuplicada(
  miId: number | string,
  esRival: (s: Record<string, string>) => boolean,
): Promise<string | null> {
  const mio = parseInt(String(miId), 10) || 0
  let rival: Record<string, string> | undefined
  try {
    rival = (await getSheetData(SHEET_RETIRO))
      .filter(s => (parseInt(s.id, 10) || 0) < mio && esRival(s))
      .sort((a, b) => (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0))[0]
  } catch (e) {
    console.warn('[agente-acciones] no pude verificar solicitudes duplicadas:', e)
    return null // best-effort: ante un fallo de lectura, seguimos el flujo normal
  }
  if (!rival) return null
  try {
    await updateByIdIf(
      SHEET_RETIRO, String(miId),
      { estado: 'pendiente' },
      { estado: 'duplicada', fecha_resolucion: new Date().toISOString() },
    )
  } catch (e) { console.warn('[agente-acciones] no pude anular la solicitud duplicada:', e) }
  console.warn(`[agente-acciones] solicitud ${miId} anulada por duplicada (gana ${rival.id})`)
  return rival.id
}

/** Últimos 9 dígitos de un número, para comparar teléfonos con formatos distintos. */
const tel9de = (n: string) => (n || '').replace(/\D/g, '').slice(-9)

/** Suma días a una fecha ISO (YYYY-MM-DD) sin salirse por la zona horaria. */
function sumarDiasISO(iso: string, dias: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + dias, 12, 0, 0))
  const p = (n: number) => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`
}

/**
 * Freno de mano de la FECHA antes de escribir un agendamiento.
 *
 * Caso real (Paulina/Mila, 2026-07-30): la clienta escribió "Hoy, 9:00", el
 * agente le ofreció por chat "las 09:41 de hoy" y al llamar la herramienta pasó
 * el 31 — arrastró el "mañana" que ella había escrito la noche anterior. Quedó
 * agendada para el día siguiente y así se lo confirmó.
 *
 * Acá cruzamos la fecha del modelo contra lo que el cliente pidió POR ESCRITO
 * HOY (ctx.diaPedido). Si no coinciden NO se agenda: se le devuelve la
 * contradicción al modelo para que la resuelva (y si su fecha era la correcta,
 * repita la llamada con confirmar_fecha=true). Nunca se corrige en silencio.
 *
 * Devuelve el texto a devolverle al modelo, o null si puede seguir.
 */
function chequearDiaPedido(fechaRaw: string, ctx: CtxAgente, confirmada?: boolean): string | null {
  const fecha = formatDateForSheet(fechaRaw)
  const hoy = fechaChileISO()
  // Una fecha pasada nunca es válida, la haya confirmado el modelo o no.
  if (fecha && fecha < hoy) {
    return `NO agendes: ${formatDateConDia(fecha)} ya pasó (hoy es ${formatDateConDia(hoy)}). ` +
      `Revisa el CALENDARIO, acuerda la fecha con el cliente y vuelve a llamar la herramienta con la fecha correcta.`
  }
  if (confirmada || !ctx.diaPedido || !fecha) return null
  const esperada = ctx.diaPedido === 'hoy' ? hoy : sumarDiasISO(hoy, 1)
  if (fecha === esperada) return null
  const palabra = ctx.diaPedido === 'hoy' ? 'hoy' : 'mañana'
  return `ALTO — la FECHA no cuadra, no agendé nada. En sus mensajes de hoy el cliente pidió "${palabra}", que es ${formatDateConDia(esperada)}, ` +
    `pero pasaste ${formatDateConDia(fecha)}. Relee el último mensaje del cliente y resuelve: ` +
    `si se refería a ${palabra}, vuelve a llamar la herramienta con fecha=${esperada}; ` +
    `si de verdad acordaron ${formatDateConDia(fecha)}, vuelve a llamarla igual agregando confirmar_fecha=true. ` +
    `NO le confirmes ninguna fecha al cliente hasta que la herramienta te devuelva el registro hecho.`
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
  const dudaFecha = chequearDiaPedido(a.fecha, ctx, a.confirmar_fecha)
  if (dudaFecha) return dudaFecha
  if (esComunaNoCubierta(a.comuna)) {
    return `NO registres este retiro: ${a.comuna} está FUERA de nuestra cobertura de retiro a domicilio. Explícaselo al cliente con amabilidad —lamentablemente no llegamos con retiro hasta esa comuna— y ofrécele las alternativas: puede acercar a su mascota a nuestras instalaciones en Recoleta, o lo derivamos al equipo para ver si hay alguna opción. NO agendes.`
  }
  if (!(await direccionValida(a.direccion, a.comuna))) {
    return `No pude validar la dirección "${a.direccion}, ${a.comuna}". Pídele al cliente que la confirme o la corrija (calle y número) y vuelve a registrarla. NO la registres aún.`
  }

  await ensureSheet(SHEET_RETIRO)
  await ensureColumns(SHEET_RETIRO, COLS_RETIRO)

  const waCliente = (ctx.waId || '').replace(/\D/g, '')
  const tel9 = waCliente.slice(-9)

  // ⚠️ Los dos candados anti-duplicado van ANTES de evaluar la hora, a propósito.
  // Iban después y el bot chocaba consigo mismo (caso real Dharma, 2026-07-29):
  // dos mensajes seguidos del cliente separados por más que el debounce dispararon
  // dos turnos; el 1º agendó las 21:00 y el 2º, al evaluar esa misma hora, la vio
  // OCUPADA — por la reserva que acababa de crear el 1º— y le respondió al cliente
  // "las 21:00 ya no está disponible", ofreciéndole otros horarios, justo antes de
  // que le llegara la confirmación de esas 21:00. Los candados nunca se ejecutaban
  // porque la evaluación de slot ya había cortado con un return.
  //
  // No permitir una SEGUNDA solicitud si el cliente YA tiene una ficha de retiro
  // en proceso. La fuente de verdad es lo VISIBLE en /clientes (ficha "borrador"/
  // por ingresar), no el log interno: así, cuando el equipo la registra o la
  // elimina, el cliente puede volver a pedir.
  //
  // El candado compara TAMBIÉN el nombre de la mascota: era solo por teléfono, así
  // que un tutor con una ficha en proceso no podía agendar el retiro de OTRA
  // mascota (le respondíamos "ya tienes una solicitud en proceso" y quedaba sin
  // poder coordinar). Lo que se busca evitar es el duplicado de la MISMA mascota.
  const mismaMascota = (a: string, b: string) =>
    normalizaNombre(a) === normalizaNombre(b) || !normalizaNombre(b)
  const clientes = await getSheetData('clientes')
  const enProceso = clientes.find(c =>
    c.estado === 'borrador' &&
    (c.telefono || '').replace(/\D/g, '').slice(-9) === tel9 &&
    mismaMascota(a.nombre_mascota, c.nombre_mascota || ''))
  if (enProceso) {
    return `Este cliente YA tiene una solicitud de retiro EN PROCESO${enProceso.nombre_mascota ? ` (${enProceso.nombre_mascota})` : ''}, que el equipo está terminando de ingresar. NO registres otra. Dile, cálido y breve, que su solicitud ya está en proceso y que la estamos gestionando; si necesita cambiar algún dato, que nos lo indique.`
  }

  // El borrador recién existe cuando el admin CONFIRMA. Entre la solicitud y ese
  // ✅, un 2º "agéndame" no vería borrador → se duplicaría la solicitud. Por eso
  // también bloqueamos si ya hay una solicitud PENDIENTE de este mismo cliente.
  const solicitudesPrevias = await getSheetData(SHEET_RETIRO)
  const pendientePrevia = solicitudesPrevias.find(
    s => s.estado === 'pendiente' &&
      (s.cliente_wa_id || '').replace(/\D/g, '').slice(-9) === tel9 &&
      mismaMascota(a.nombre_mascota, s.nombre_mascota || '')
  )
  if (pendientePrevia) {
    return `Este cliente YA tiene una solicitud de retiro PENDIENTE de confirmación${pendientePrevia.nombre_mascota ? ` (${pendientePrevia.nombre_mascota})` : ''}. NO registres otra. Dile, cálido y breve, que ya recibimos su solicitud y la estamos confirmando; si necesita cambiar algún dato, que nos lo indique.`
  }

  const slot = await evaluarSlotRetiro(a.fecha, a.hora)
  if (!slot.ok) {
    const libres = slot.libres.length ? ` Horarios disponibles ese día: ${slot.libres.join(', ')}.` : ''
    return `NO registres este retiro: ${slot.motivo}${libres} Explícaselo al cliente con amabilidad y ofrécele uno de los horarios disponibles; vuelve a llamar la herramienta solo cuando acuerden una hora válida.`
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
    fecha_creacion: fechaChileISO(),
    fecha_resolucion: '',
  })

  // Perdedor de una carrera (dos turnos del agente en paralelo): se anula y no
  // se avisa al equipo, así el retiro no queda agendado dos veces.
  const ganadora = await anularSiDuplicada(id, s =>
    tel9de(s.cliente_wa_id) === tel9 &&
    (s.estado === 'pendiente' ||
      (s.estado === 'confirmada' && s.fecha_retiro === a.fecha && s.hora_retiro === a.hora)))
  if (ganadora) {
    return `Esta solicitud YA había quedado registrada (N° ${ganadora}) — se estaba procesando en paralelo. NO registres otra ni repitas el aviso: dile al cliente, cálido y breve, que su solicitud de retiro ya está recibida y que le confirmaremos a la brevedad.`
  }

  const resumen =
    `🐾 *Nueva solicitud de retiro*\n\n` +
    `Tutor: ${a.nombre_tutor}\n` +
    `Mascota: ${a.nombre_mascota} (${a.peso} kg)\n` +
    `Dirección: ${a.direccion}, ${a.comuna}\n` +
    `Fecha: ${formatDate(a.fecha)} a las ${a.hora}\n` +
    (a.tipo_servicio ? `Servicio: ${a.tipo_servicio}\n` : '') +
    (waCliente ? `Cliente: +${waCliente}\n` : '') +
    `\n¿Confirmas este retiro?`

  const env = await avisarRetiroAlEquipo({
    resumen,
    vars: varsPlantillaRetiro({
      quien: a.nombre_tutor, mascota: a.nombre_mascota, peso: a.peso,
      direccion: a.direccion, comuna: a.comuna, fecha: a.fecha, hora: a.hora, contacto: waCliente,
    }),
    botones: [
      { id: `retiro_ok:${id}`, title: '✅ Confirmar' },
      { id: `retiro_no:${id}`, title: '❌ Rechazar' },
    ],
  })

  if (!env.ok) {
    console.warn('[agente-acciones] no se pudo avisar al admin:', env.error)
    return `La solicitud quedó registrada (N° ${id}) pero no pude avisar al equipo automáticamente. Dile al cliente que su solicitud fue recibida y que le confirmaremos a la brevedad.`
  }

  return `Solicitud de retiro registrada (N° ${id}) y enviada al equipo para confirmación. ` +
    `Confirma al cliente que RECIBIMOS su solicitud para el ${formatDateConDia(a.fecha)} a las ${a.hora} y que le avisaremos por este mismo medio apenas la validemos. ` +
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
  const dudaFecha = chequearDiaPedido(a.fecha, ctx, a.confirmar_fecha)
  if (dudaFecha) return dudaFecha

  // Primero se busca el retiro del cliente y RECIÉN DESPUÉS se evalúa la hora
  // nueva, excluyéndolo del cálculo: una reserva no puede bloquearse a sí misma.
  // Al revés (como estaba), mover un retiro de 21:00 a 20:45 chocaba contra su
  // propio horario actual —30 min antes / 45 después— y el bot respondía que no
  // había disponibilidad. Mismo defecto que el de solicitarRetiro.
  await ensureSheet(SHEET_RETIRO)
  await ensureColumns(SHEET_RETIRO, COLS_RETIRO)
  const solicitudes = await getSheetData(SHEET_RETIRO)
  const propias = solicitudes
    .filter(s => ['pendiente', 'confirmada'].includes(s.estado || '') && (s.cliente_wa_id || '').replace(/\D/g, '').slice(-9) === tel9)
    .sort((x, y) => (parseInt(y.id, 10) || 0) - (parseInt(x.id, 10) || 0))
  const sol = propias[0]
  if (!sol) {
    // Sin retiro propio: puede ser un cliente de EUTANASIA queriendo mover su
    // visita. Antes el bot le respondía "no tienes ningún retiro" y el cambio
    // había que hacerlo a mano.
    const movida = await reprogramarEutanasia(a, tel9)
    if (movida) return movida
    return 'Este cliente no tiene ningún retiro pendiente ni confirmado a su nombre para reprogramar. Si quiere agendar uno nuevo, usa la herramienta solicitar_retiro_cremacion en vez de esta.'
  }

  const slot = await evaluarSlotRetiro(a.fecha, a.hora, { excluirAgendaId: `r${sol.id}` })
  if (!slot.ok) {
    const libres = slot.libres.length ? ` Horarios disponibles ese día: ${slot.libres.join(', ')}.` : ''
    return `NO reprogrames: ${slot.motivo}${libres} Explícaselo al cliente con amabilidad y ofrécele uno de los horarios disponibles; vuelve a llamar la herramienta solo cuando acuerden una hora válida.`
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

  return `Listo, retiro reprogramado para el ${formatDateConDia(a.fecha)} a las ${a.hora}. Confírmaselo al cliente con calidez y dile que el equipo ya quedó al tanto del cambio.`
}

/**
 * Reprograma la EUTANASIA a domicilio del cliente (si tiene una viva). Devuelve
 * el texto para el modelo, o null si no hay ninguna (para que el caller siga con
 * su propio mensaje).
 *
 * Mueve la cotización —que es lo que lee la agenda— y arrastra la ficha de
 * cremación. Si ya hay un veterinario asignado, se le avisa por correo: él
 * coordinó la visita con la familia y no puede enterarse en la puerta.
 */
async function reprogramarEutanasia(a: AccionReprogramar, tel9: string): Promise<string | null> {
  const cotis = await getSheetData('cotizaciones_eutanasia').catch(() => [] as Record<string, string>[])
  const propia = cotis
    .filter(c => ['creada', 'enviada', 'aceptada'].includes((c.estado || '').toLowerCase()) &&
      (c.cliente_wa_id || c.cliente_telefono || '').replace(/\D/g, '').slice(-9) === tel9)
    .sort((x, y) => (parseInt(y.id, 10) || 0) - (parseInt(x.id, 10) || 0))[0]
  if (!propia) return null

  const ev = await evaluarHoraEutanasia(a.fecha, a.hora)
  if (!ev.ok) {
    const libres = ev.libres.length ? ` Horas libres ese día: ${ev.libres.join(', ')}.` : ''
    return `NO reprogrames la eutanasia: ${ev.motivo}${libres} Explícaselo al cliente y vuelve a llamar la herramienta con la hora que ELIJA.`
  }

  const fechaAntes = formatDate(propia.fecha_servicio)
  const horaAntes = propia.hora_servicio || ''
  const patch: Record<string, string> = { fecha_servicio: a.fecha, hora_servicio: a.hora }
  // La hora del retiro del crematorio sigue a la del procedimiento, pero solo si
  // el vet ya la había informado (si está en blanco, se define cuando coordine).
  let retiroReprog: RetiroTrasEutanasia | null = null
  if (propia.hora_retiro_crematorio) {
    retiroReprog = await retiroTrasEutanasia(a.fecha, a.hora, { excluirAgendaId: `e${propia.id}` })
    patch.hora_retiro_crematorio = retiroReprog.hora
  }
  await updateByIdIf('cotizaciones_eutanasia', propia.id, {}, patch)
  await sincronizarFichaDeEutanasia({ ...propia, ...patch })

  // Avisar al vet asignado (correo) y al equipo (WhatsApp).
  if (propia.vet_email_asignado) {
    try {
      await enviarVetCambioFechaEutanasia({
        email: propia.vet_email_asignado,
        vetNombre: propia.vet_nombre_asignado || '',
        mascota: propia.mascota_nombre || '',
        tutor: propia.cliente_nombre || '',
        direccion: `${propia.direccion || ''}, ${propia.comuna || ''}`,
        fecha: formatDate(a.fecha),
        hora: a.hora,
        antes: `${fechaAntes}${horaAntes ? ` a las ${horaAntes}` : ''}`,
      })
    } catch (e) { console.warn('[agente-acciones] aviso de cambio al vet falló:', e) }
  }
  try {
    await avisarAdminsWhatsapp(
      `🔁 *Eutanasia reprogramada por el cliente* (N° ${propia.id})\n\n` +
      `Mascota: ${propia.mascota_nombre}\nTutor: ${propia.cliente_nombre}\n` +
      `Antes: ${fechaAntes}${horaAntes ? ` a las ${horaAntes}` : ''}\n` +
      `AHORA: ${formatDate(a.fecha)} a las ${a.hora}\n` +
      (propia.vet_nombre_asignado ? `Vet asignado: ${propia.vet_nombre_asignado} (le avisamos por correo)` : '⚠ Sin vet asignado todavía'))
  } catch (e) { console.warn('[agente-acciones] aviso admin eutanasia reprogramada falló:', e) }

  // Si el retiro tuvo que correrse (su media hora estaba topada), el cliente
  // tiene que enterarse ACÁ mismo: es nuestra hora, no la del veterinario.
  const notaRetiro = retiroReprog
    ? retiroReprog.desplazado
      ? ` OJO, díselo: nosotros pasamos a retirar a las ${retiroReprog.hora} (no a las ${retiroReprog.base}), porque a esa hora ya teníamos otro retiro comprometido y la tomamos en el primer horario libre después del procedimiento.`
      : ` Nosotros pasamos a retirar a las ${retiroReprog.hora}: díselo también.`
    : ''
  return `Listo, la eutanasia quedó reprogramada para el ${formatDateConDia(a.fecha)} a las ${a.hora}.${notaRetiro} ` +
    `Confírmaselo al cliente con calidez${propia.vet_nombre_asignado ? ' y dile que ya le avisamos al veterinario asignado' : ' y dile que el equipo está coordinando al veterinario'}.`
}

/**
 * Cancela lo que el cliente tenga agendado: su retiro de cremación o su
 * eutanasia. Libera el horario de la agenda y avisa al equipo.
 *
 * El bot no tenía forma de cancelar: escalaba, y el bloque quedaba tomado hasta
 * que alguien lo borrara a mano. La ficha BORRADOR ligada se elimina (nació de
 * ese agendamiento); una ficha ya REGISTRADA no se toca nunca — ahí ya hay una
 * mascota con nosotros y lo resuelve el equipo.
 */
async function cancelarAgendamiento(a: AccionCancelar, ctx: CtxAgente): Promise<string> {
  const tel9 = (ctx.waId || '').replace(/\D/g, '').slice(-9)
  if (!tel9) return 'No pude identificar el WhatsApp del cliente para cancelar. Escala a un humano.'
  const motivo = (a.motivo || '').trim()
  const ahora = new Date().toISOString()

  const [solicitudes, cotis, clientes] = await Promise.all([
    getSheetData(SHEET_RETIRO).catch(() => [] as Record<string, string>[]),
    getSheetData('cotizaciones_eutanasia').catch(() => [] as Record<string, string>[]),
    getSheetData('clientes').catch(() => [] as Record<string, string>[]),
  ])

  const sol = solicitudes
    .filter(s => ['pendiente', 'confirmada'].includes(s.estado || '') && tel9de(s.cliente_wa_id) === tel9)
    .sort((x, y) => (parseInt(y.id, 10) || 0) - (parseInt(x.id, 10) || 0))[0]
  const cot = cotis
    .filter(c => ['creada', 'enviada', 'aceptada'].includes((c.estado || '').toLowerCase()) &&
      (c.cliente_wa_id || c.cliente_telefono || '').replace(/\D/g, '').slice(-9) === tel9)
    .sort((x, y) => (parseInt(y.id, 10) || 0) - (parseInt(x.id, 10) || 0))[0]

  if (!sol && !cot) {
    return 'Este cliente no tiene ningún servicio agendado a su nombre (ni retiro ni eutanasia), así que no hay nada que cancelar. Si insiste en que sí, escala a un humano en vez de inventar.'
  }

  // Ficha borrador ligada: se elimina, igual que cuando el equipo borra la ficha
  // desde el panel. Una ficha con código NO se toca.
  const borrarFichaSiBorrador = async (clienteId: string) => {
    const cid = String(clienteId || '').trim()
    if (!cid) return false
    const ficha = clientes.find(c => String(c.id) === cid)
    if (!ficha || (ficha.estado || '') !== 'borrador') return false
    // Por ID, no por índice: entre la lectura y el borrado puede entrar otra ficha.
    try { await deleteById('clientes', cid); return true } catch (e) {
      console.warn('[agente-acciones] no se pudo borrar la ficha borrador al cancelar:', e); return false
    }
  }

  const detalle: string[] = []
  let quedaFicha = false
  if (sol) {
    await updateByIdIf(SHEET_RETIRO, sol.id, { estado: sol.estado }, { estado: 'cancelada', fecha_resolucion: ahora })
    const borrada = await borrarFichaSiBorrador(sol.cliente_id)
    if (sol.cliente_id && !borrada) quedaFicha = true
    detalle.push(`retiro de ${sol.nombre_mascota || 'la mascota'} (${formatDate(sol.fecha_retiro)} ${sol.hora_retiro})`)
  }
  if (cot) {
    await updateByIdIf('cotizaciones_eutanasia', cot.id, { estado: cot.estado }, { estado: 'cancelada', fecha_cancelacion: ahora })
    const borrada = await borrarFichaSiBorrador(cot.cliente_id)
    if (cot.cliente_id && !borrada) quedaFicha = true
    detalle.push(`eutanasia de ${cot.mascota_nombre || 'la mascota'} (${formatDate(cot.fecha_servicio)} ${cot.hora_servicio})`)
  }

  try {
    await avisarAdminsWhatsapp(
      `🚫 *Cancelación pedida por el cliente*\n\n` +
      `${detalle.join('\n')}\n` +
      (motivo ? `Motivo: ${motivo}\n` : '') +
      `Cliente: +${(ctx.waId || '').replace(/\D/g, '')}\n` +
      (cot?.vet_nombre_asignado ? `\n⚠ La eutanasia tenía asignado a ${cot.vet_nombre_asignado}: hay que avisarle.` : '') +
      (quedaFicha ? '\n⚠ La ficha ya estaba registrada: revísala en /clientes.' : ''))
  } catch (e) { console.warn('[agente-acciones] aviso de cancelación falló:', e) }

  return `Listo, cancelé ${detalle.join(' y ')} y avisé al equipo. Dile al cliente, breve y cálido, que quedó cancelado y que si más adelante nos necesita estamos disponibles. NO le pidas explicaciones ni intentes retenerlo.`
}

// ─── Flujo A-vet: retiro originado por un veterinario de convenio ─────────────

/** Normaliza un nombre para comparar (minúsculas, sin tildes ni puntuación). */
function normalizaNombre(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Busca un veterinario de convenio ACTIVO (match flexible). Coincide contra el
 * NOMBRE de fantasía, la RAZÓN SOCIAL y el NOMBRE DE CONTACTO (el vet puede darnos
 * cualquiera), también por RUT si lo escribe, y cuando quedan varios candidatos
 * los DESEMPATA por comuna. Así evitamos el "no te encuentro" cuando el nombre de
 * fantasía no calza letra por letra con el titular registrado.
 */
async function buscarVetConvenio(nombre: string, comuna?: string): Promise<{ unico?: Record<string, string>; varios?: Record<string, string>[] }> {
  const q = normalizaNombre(nombre)
  const qDig = (nombre || '').replace(/\D/g, '')
  if (q.length < 3 && qDig.length < 7) return {}
  const vets = (await getSheetData('veterinarios')).filter(v => /^(true|verdadero|1)$/i.test((v.activo || '').trim()))
  const nombresDe = (v: Record<string, string>) =>
    [v.nombre, v.razon_social, v.nombre_contacto].filter(Boolean).map(normalizaNombre)
  const desempatar = (cands: Record<string, string>[]) => {
    if (cands.length === 1) return { unico: cands[0] }
    const c = normalizaNombre(comuna || '')
    const porComuna = c ? cands.filter(v => normalizaNombre(v.comuna) === c) : []
    if (porComuna.length === 1) return { unico: porComuna[0] }
    return { varios: cands }
  }
  // 1) por RUT exacto (si el vet lo escribió)
  if (qDig.length >= 7) {
    const porRut = vets.filter(v => (v.rut || '').replace(/\D/g, '') === qDig)
    if (porRut.length) return desempatar(porRut)
  }
  if (q.length < 3) return {}
  // 2) coincidencia exacta contra cualquiera de los nombres
  const exactos = vets.filter(v => nombresDe(v).some(n => n === q))
  if (exactos.length) return desempatar(exactos)
  // 3) coincidencia parcial (uno contiene al otro)
  const parciales = vets.filter(v => nombresDe(v).some(n => n.length >= 3 && (n.includes(q) || q.includes(n))))
  if (parciales.length) return desempatar(parciales)
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
  const dudaFecha = chequearDiaPedido(a.fecha, ctx, a.confirmar_fecha)
  if (dudaFecha) return dudaFecha
  // Cobertura: el flujo del tutor la chequeaba y este no, así que una clínica de
  // una comuna donde NO llegamos quedaba agendada sin que nadie lo notara.
  if (esComunaNoCubierta(a.comuna)) {
    return `NO registres este retiro: ${a.comuna} está FUERA de nuestra cobertura de retiro. Explícaselo al veterinario con amabilidad y ofrécele las alternativas: pueden acercar a la mascota a nuestras instalaciones en Recoleta, o lo derivamos al equipo para ver si hay alguna opción. NO agendes.`
  }
  const { unico, varios } = await buscarVetConvenio(a.veterinaria_nombre, a.comuna)
  if (varios && varios.length > 1) {
    const nombres = varios.slice(0, 4).map(v => v.nombre).filter(Boolean).join(', ')
    return `Hay varios veterinarios en la base que coinciden con "${a.veterinaria_nombre}" (${nombres}). Pídele al veterinario que indique el nombre exacto de su clínica (o el RUT) para identificarlo bien. NO agendes todavía.`
  }
  if (!unico) {
    return `No encontré al veterinario "${a.veterinaria_nombre}" en nuestra base de convenio. Antes de escalar, pídele el nombre EXACTO de la clínica tal como está en el convenio o su RUT, y vuelve a intentar registrarlo con ese dato. Si aun así no aparece, NO agendes: usa la herramienta escalar_a_humano explicando que un veterinario quiere agendar un retiro y no pudimos identificarlo en la base, y dile al veterinario —cálido y breve— que un miembro del equipo lo contactará en seguida para coordinar.`
  }

  if (!(await direccionValida(a.direccion, a.comuna))) {
    return `No pude validar la dirección "${a.direccion}, ${a.comuna}". Pídele al veterinario que la confirme o la corrija (calle y número) y vuelve a registrarla. NO la registres aún.`
  }

  await ensureSheet(SHEET_RETIRO)
  await ensureColumns(SHEET_RETIRO, COLS_RETIRO)
  const waVet = (ctx.waId || '').replace(/\D/g, '')

  // ⚠️ El candado anti-duplicado va ANTES de evaluar la hora, igual que en el
  // flujo del tutor. Si va después, la evaluación de slot corta con un `return` y
  // el candado nunca se ejecuta: el bot ve OCUPADA la hora que él mismo acaba de
  // reservar y le ofrece otros horarios al veterinario, como si la reserva que
  // recién confirmó no existiera.
  //
  // Caso real (Remy, convenio Daniella Millas, 2026-08-09): el retiro quedó
  // agendado a las 11:00 y un minuto después la veterinaria mandó los datos de la
  // tutora. El modelo leyó ese mensaje como una solicitud nueva, volvió a llamar
  // la herramienta y le respondió "a las 11:00 no tenemos disponibilidad" —
  // justo la hora que le acababa de confirmar.
  //
  // Acá NO se bloquea "una ficha en proceso" como en el flujo del tutor (un
  // veterinario agenda muchos retiros distintos): se bloquea solo el MISMO
  // retiro, o sea mismo número + misma mascota + solicitud todavía vigente.
  const vigente = (await getSheetData(SHEET_RETIRO)).find(s =>
    ['pendiente', 'confirmada'].includes(s.estado || '') &&
    tel9de(s.cliente_wa_id) === tel9de(waVet) &&
    normalizaNombre(s.nombre_mascota || '') === normalizaNombre(a.nombre_mascota))
  if (vigente) {
    return `El retiro de ${a.nombre_mascota} YA está registrado (N° ${vigente.id}, ${formatDateConDia(vigente.fecha_retiro)} a las ${vigente.hora_retiro}) y sigue vigente. NO lo registres de nuevo y NO le ofrezcas otros horarios. ` +
      `Si el veterinario está mandando datos ADICIONALES (tutor, teléfono, peso, correo), agradécele y dile que quedaron anotados para la ficha — nada más. ` +
      `Si lo que quiere es CAMBIAR la fecha o la hora, usa la herramienta de reprogramar, no esta. Y si es el retiro de OTRA mascota, vuelve a llamarla con el nombre correcto.`
  }

  const slot = await evaluarSlotRetiro(a.fecha, a.hora)
  if (!slot.ok) {
    const libres = slot.libres.length ? ` Horarios disponibles ese día: ${slot.libres.join(', ')}.` : ''
    return `NO registres este retiro: ${slot.motivo}${libres} Explícaselo al veterinario y ofrécele uno de los horarios disponibles; vuelve a llamar la herramienta solo cuando acuerden una hora válida.`
  }

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
    fecha_creacion: fechaChileISO(),
    fecha_resolucion: '',
    origen: 'bot_vet',
    veterinaria_id: unico.id || '',
    vet_nombre: unico.nombre || '',
    vet_email: unico.correo || '',
  })

  // Mismo cierre de carrera que en el flujo del tutor, pero acotado al MISMO
  // retiro (un vet sí agenda varios seguidos): misma mascota, fecha y hora.
  const ganadora = await anularSiDuplicada(id, s =>
    ['pendiente', 'confirmada'].includes(s.estado || '') &&
    tel9de(s.cliente_wa_id) === tel9de(waVet) &&
    (s.nombre_mascota || '').trim().toLowerCase() === a.nombre_mascota.trim().toLowerCase() &&
    s.fecha_retiro === a.fecha && s.hora_retiro === a.hora)
  if (ganadora) {
    return `Este retiro YA había quedado registrado (N° ${ganadora}) — se estaba procesando en paralelo. NO registres otro ni repitas el aviso: confírmale al veterinario, breve, que la solicitud de retiro de ${a.nombre_mascota} ya está recibida y que le avisaremos apenas la validemos.`
  }

  const resumen =
    `🐾 *Nueva solicitud de retiro (VETERINARIO)*\n\n` +
    `Veterinario: ${unico.nombre || a.veterinaria_nombre}\n` +
    `Mascota: ${a.nombre_mascota} (${a.peso} kg)\n` +
    `Dirección: ${a.direccion}, ${a.comuna}\n` +
    `Fecha: ${formatDate(a.fecha)} a las ${a.hora}\n` +
    (a.tipo_servicio ? `Servicio: ${a.tipo_servicio}\n` : '') +
    (waVet ? `Contacto: +${waVet}\n` : '') +
    `\n¿Confirmas este retiro?`

  const env = await avisarRetiroAlEquipo({
    resumen,
    vars: varsPlantillaRetiro({
      quien: `${unico.nombre || a.veterinaria_nombre} (veterinario)`, mascota: a.nombre_mascota, peso: a.peso,
      direccion: a.direccion, comuna: a.comuna, fecha: a.fecha, hora: a.hora, contacto: waVet,
    }),
    botones: [
      { id: `retiro_ok:${id}`, title: '✅ Confirmar' },
      { id: `retiro_no:${id}`, title: '❌ Rechazar' },
    ],
  })

  if (!env.ok) {
    console.warn('[agente-acciones] no se pudo avisar al admin (vet):', env.error)
    return `La solicitud quedó registrada (N° ${id}) pero no pude avisar al equipo automáticamente. Dile al veterinario que su solicitud fue recibida y que le confirmaremos a la brevedad.`
  }

  return `Solicitud de retiro registrada (N° ${id}) para el veterinario ${unico.nombre || a.veterinaria_nombre} y enviada al equipo para confirmación. ` +
    `Confirma al veterinario que RECIBIMOS la solicitud de retiro de ${a.nombre_mascota} para el ${formatDateConDia(a.fecha)} a las ${a.hora} y que le avisaremos apenas la validemos. ` +
    `NO le digas que ya está confirmada.`
}

// ─── Cotización de cremación (determinística) ────────────────────────────────

/**
 * Cotiza la CREMACIÓN con los precios reales de la tabla: resuelve el tramo del
 * peso con `findTramo` (regla de borde canónica) y arma las tres modalidades ya
 * con los recargos que correspondan.
 *
 * Nace de un error real (caso Yami, 2026-07-28): el modelo leía la tabla de
 * tramos del prompt y cotizó una mascota de 1,5 kg con el tramo 2–5 kg
 * ($85.000 en vez de $75.000), y encima presentó el recargo dos veces. Con esta
 * herramienta el modelo NO calcula nada: copia los montos que le devolvemos.
 *
 * El recargo FUERA DE HORARIO se cobra UNA sola vez por atención: si la
 * eutanasia asociada ya lo lleva, acá no se suma (ver lib/adicionales-auto).
 */
async function cotizarCremacion(a: AccionCotizarCremacion): Promise<string> {
  const peso = Number(a.peso)
  if (!Number.isFinite(peso) || peso <= 0) {
    return 'Necesito el peso aproximado de la mascota para cotizar la cremación. Pídeselo al cliente.'
  }
  const [tramos, otros] = await Promise.all([
    getSheetData('precios_generales').catch(() => [] as Record<string, string>[]),
    getSheetData('otros_servicios').catch(() => [] as Record<string, string>[]),
  ])
  const tramo = findTramo(tramos as never, peso)
  if (!tramo) {
    return 'No encontré un tramo de precio para ese peso. No inventes un valor: ofrécele que un miembro del equipo lo contacte o escala a un humano.'
  }
  const base = {
    CI: precioDelTramo(tramo as never, 'CI'),
    CP: precioDelTramo(tramo as never, 'CP'),
    SD: precioDelTramo(tramo as never, 'SD'),
  }

  // Recargos automáticos con la MISMA regla de la ficha (lib/adicionales-auto).
  const activo = (r: Record<string, string>) => String(r.activo || '').toUpperCase() === 'TRUE'

  // Si el cliente todavía no dio fecha/hora (el caso normal de la PRIMERA
  // cotización), asumimos el PRÓXIMO RETIRO POSIBLE — que es justo lo que el bot
  // le va a ofrecer. Sin esto la herramienta contestaba "no aplica recargo"
  // mientras el prompt le exigía avisarlo, y el modelo se ponía a discutir
  // consigo mismo delante del cliente (ver lib/agenda.ts → calcularProximoRetiro).
  let fecha = formatDateForSheet(a.fecha) || String(a.fecha || '')
  let hora = String(a.hora || '')
  let asumido = false
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    try {
      const prox = await proximoRetiroPosible()
      fecha = prox.iso
      hora = prox.hora
      asumido = true
    } catch { /* sin agenda: se cotiza sin recargo horario, como antes */ }
  }
  const ctx = { fecha, hora, comuna: String(a.comuna || '') }
  const recargos: { nombre: string; monto: number }[] = []
  for (const s of otros.filter(r => activo(r) && (r.auto_regla || '').trim())) {
    const esFueraHorario = (s.auto_regla || '').trim() === 'fuera_horario'
    const aplica = esFueraHorario
      ? cremacionLlevaRecargoFueraHorario({
          retiroFueraHorario: aplicaReglaAuto(s, ctx),
          eutanasiaYaCobraRecargo: !!a.eutanasia_fuera_horario,
        })
      : aplicaReglaAuto(s, ctx)
    if (aplica) recargos.push({ nombre: s.nombre || (esFueraHorario ? 'Retiro fuera de horario' : 'Adicional por distancia'), monto: parseInt(s.precio, 10) || 0 })
  }
  const sumaRecargos = recargos.reduce((s, r) => s + r.monto, 0)

  const linea = (cod: 'CI' | 'CP' | 'SD', nombre: string) =>
    `- ${nombre}: ${fmtPrecio(base[cod])}${sumaRecargos > 0 ? ` + recargos ${fmtPrecio(sumaRecargos)} = TOTAL ${fmtPrecio(base[cod] + sumaRecargos)}` : ''}`

  // El texto dice SIEMPRE la última palabra sobre recargos: es la única fuente.
  // Nada de "puede que aplique" ni de pedirle al modelo que lo decida él.
  const notaAsumido = asumido
    ? ` (calculados para el próximo retiro posible, ${fecha} a las ${hora}, que es lo que le vas a ofrecer)`
    : ''
  const detalleRecargos = recargos.length
    ? `\nRecargos que aplican${notaAsumido} — van como UNA línea aparte y se suman UNA sola vez:\n${recargos.map(r => `- ${r.nombre}: ${fmtPrecio(r.monto)}`).join('\n')}`
    : `\nNO aplica ningún recargo${notaAsumido}. Esta es la respuesta definitiva: NO menciones recargos, no los deduzcas del día ni de la hora, y no discutas este resultado.`

  // Con eutanasia fuera de horario el recargo YA se cobra con la eutanasia: la
  // cremación no lo suma, pero el cliente igual tiene que oírlo UNA vez (si no,
  // lo descubre al pagar). Nunca dos veces.
  const notaEut = a.eutanasia_fuera_horario
    ? `\nATENCIÓN: la eutanasia ya lleva el recargo fuera de horario, así que la cremación NO lo suma (el recargo se cobra UNA sola vez en toda la atención, no dos). Igual dile al cliente que hay UN recargo por fuera de horario y que va con la eutanasia — que no lo descubra al pagar.`
    : ''

  return `PRECIOS EXACTOS de cremación para ${peso} kg (tramo ${tramo.peso_min}–${tramo.peso_max} kg). Escríbelos TAL CUAL, sin recalcular ni redondear:
${linea('CI', 'Cremación Individual')}
${linea('CP', 'Cremación Premium')}
${linea('SD', 'Cremación Sin Devolución')}${detalleRecargos}${notaEut}
Reglas al escribir la cotización: da UN precio final por modalidad (con los recargos ya sumados) y muestra el recargo como una línea aparte del desglose. NUNCA digas "a esto hay que sumarle X" después de haber dado un total, ni sumes el mismo recargo dos veces.`
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

  // El recargo fuera de horario lo resuelve la herramienta, no el modelo, y va en
  // los DOS escenarios: se cobra por la visita del veterinario, que ocurre igual
  // aunque al evaluar no corresponda la eutanasia. Sin fecha/hora se asume AHORA
  // (que es cuando la mayoría pregunta y para cuando la piden) y se avisa.
  const ahora = ahoraChile()
  const fecha = formatDateForSheet(a.fecha || '') || ahora.iso
  const hora = (a.hora || '').trim() || `${String(Math.floor(ahora.min / 60)).padStart(2, '0')}:${String(ahora.min % 60).padStart(2, '0')}`
  const asumido = !a.fecha
  const recargoFuera = recargoEutanasiaPara(fecha, hora, recargo)
  const totalRealizada = cliente + recargoFuera
  const totalConsulta = consulta.total + recargoFuera
  const notaAsumido = asumido ? ` (calculado para HOY ${formatDateConDia(fecha)}; si acuerdan otra fecha, vuelve a cotizar con esa fecha)` : ''
  const detalleRecargo = recargoFuera > 0
    ? `\nRECARGO fuera de horario: ${fmtPrecio(recargoFuera)}${notaAsumido}. Va INCLUIDO en los dos totales de arriba, se nombra UNA sola vez y se suma UNA sola vez en TODA la atención. Si además hay cremación, NO lo cobres de nuevo ahí: cotiza con "cotizar_cremacion" pasándole eutanasia_fuera_horario=true y usa los montos que devuelva.`
    : `\nNO aplica recargo fuera de horario${notaAsumido}. Es la respuesta definitiva: no lo menciones ni lo deduzcas del día o la hora.`

  // ⚠️ El escenario "no corresponde" NO lleva cremación, y hay que decirlo con
  // todas las letras. Caso real (Niebla, 2026-08-09): al cotizar el servicio
  // integral el modelo armó "Total si solo es consulta: $175.000" sumándole la
  // cremación de $135.000 a la consulta. Si el veterinario evalúa y no realiza la
  // eutanasia, la mascota sigue VIVA: no hay retiro ni cremación que cobrar. El
  // recargo SÍ va (se cobra por la visita, que ocurrió igual).
  return `Es un servicio de EVALUACIÓN a domicilio: un veterinario de la red visita a la mascota y evalúa si corresponde la eutanasia. Estos son los TOTALES FINALES al cliente para ${peso} kg — escríbelos TAL CUAL, ya traen el recargo que corresponda y NO les sumes nada:
- Si SE REALIZA la eutanasia: ${fmtPrecio(totalRealizada)}
- Si al evaluar NO corresponde (solo la visita): ${fmtPrecio(totalConsulta)}${detalleRecargo}

REGLA DURA del escenario "NO corresponde": la mascota sigue VIVA, así que NO hay retiro ni cremación. Ese total es ${fmtPrecio(totalConsulta)} y punto: NUNCA le sumes la cremación ni un ánfora. La cremación existe SOLO en el escenario en que la eutanasia SE REALIZA, y va como un monto APARTE que se suma únicamente a ese lado. Si muestras los dos totales del servicio integral, el de "solo consulta" tiene que ser el MÁS BARATO por lejos; si te queda parecido al otro, te equivocaste.
NO expliques cómo se reparte internamente ninguno de estos montos ni uses las tarifas de cremación para calcularlos. Si decide avanzar, junta los datos y agéndala.`
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
  const dudaFecha = chequearDiaPedido(a.fecha, ctx, a.confirmar_fecha)
  if (dudaFecha) return dudaFecha
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
      // Igual que en los retiros, el candado mira también la MASCOTA: el duplicado
      // que hay que evitar es el de la misma solicitud, no el de una familia con
      // dos mascotas.
      const activa = cotis.find(c =>
        ['creada', 'enviada', 'aceptada'].includes(c.estado || '') &&
        (c.cliente_wa_id || c.cliente_telefono || '').replace(/\D/g, '').slice(-9) === tel9 &&
        (normalizaNombre(c.mascota_nombre || '') === normalizaNombre(a.nombre_mascota) || !normalizaNombre(c.mascota_nombre || ''))
      )
      if (activa) {
        return `Este cliente YA tiene una solicitud de eutanasia ACTIVA (N° ${activa.id}${activa.mascota_nombre ? `, ${activa.mascota_nombre}` : ''}). NO agendes otra. Dile, cálido y breve, que su solicitud ya quedó ingresada y que estamos coordinando con la red de veterinarios; si quiere corregir algún dato, tómalo por mensaje y responde que el equipo lo ajustará.`
      }
    } catch (e) {
      console.warn('[agente-acciones] dedup eutanasia falló (no bloquea):', e)
    }
  }

  // HORA DEL SERVICIO. Si el cliente acordó una hora EXACTA, esa manda: se valida
  // contra la agenda y, si no se puede, NO se agenda ni se mueve en silencio — se
  // le devuelven al modelo las horas libres para que las converse con el cliente.
  //
  // Caso real (Gasparín, 2026-07-28): la clienta pidió las 21:00, el agente se lo
  // confirmó por escrito y la solicitud salió agendada a las 17:30, porque la
  // herramienta solo recibía la FRANJA y `horaLibreEnFranja` elige la hora libre
  // más cercana a la representativa de la franja (10:00 AM / 16:00 PM).
  const horaPedida = /^([01]?\d|2[0-3]):[0-5]\d$/.test((a.hora || '').trim())
    ? (a.hora || '').trim().padStart(5, '0')
    : ''
  // Con hora exacta, la franja sale de ella (corte 13:00) — así el match de vets
  // usa la franja real y no la que hubiera mandado el modelo.
  const franja: 'AM' | 'PM' = horaPedida
    ? (parseInt(horaPedida.slice(0, 2), 10) < 13 ? 'AM' : 'PM')
    : ((a.franja || '').toUpperCase() === 'PM' ? 'PM' : 'AM')

  let hora = ''
  if (horaPedida) {
    const ev = await evaluarHoraEutanasia(a.fecha, horaPedida)
    if (!ev.ok) {
      const libres = ev.libres.length
        ? ` Horas libres ese día: ${ev.libres.join(', ')}.`
        : ' Ese día ya no quedan horas libres.'
      return `NO agendes: no podemos tomar las ${horaPedida} del ${formatDateConDia(a.fecha)}. Motivo: ${ev.motivo || 'esa hora no está disponible.'}${libres} ` +
        `Explícaselo al cliente con calidez, ofrécele esas horas (o el día siguiente) y vuelve a llamar la herramienta con la hora que ELIJA. ` +
        `NUNCA agendes una hora distinta de la que acordaste con el cliente: si no se puede, se conversa, no se cambia por dentro.`
    }
    hora = horaPedida
  } else {
    // Sin hora exacta: primera hora LIBRE de la franja (respeta la separación con
    // las demás reservas). AM=mañana, PM=tarde.
    const { hora: h } = await horaLibreEnFranja(a.fecha, franja)
    if (!h) {
      const otra = franja === 'PM' ? 'la mañana' : 'la tarde'
      return `NO agendes: la franja de ${franja === 'PM' ? 'la tarde' : 'la mañana'} del ${formatDateConDia(a.fecha)} ya está completa (dejamos al menos 1 hora entre cada servicio agendado). Ofrécele al cliente ${otra} de ese día u otro día, y vuelve a llamar la herramienta cuando elija.`
    }
    hora = h
  }

  const sinCremacion = (a.tipo_servicio_cremacion || '').toUpperCase() === 'NINGUNA'
  const notas = `Solicitud vía WhatsApp (bot). ${horaPedida ? `Hora acordada con el cliente: ${horaPedida}.` : `Franja preferida: ${franja === 'PM' ? 'tarde' : 'mañana'} (sin hora exacta).`}` +
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
    `Fecha: ${formatDate(a.fecha)} · ${hora} hrs (${franja === 'PM' ? 'tarde' : 'mañana'})\n` +
    cremTxt +
    (waCliente ? `Cliente: +${waCliente}` : '') + (a.email ? ` · ${a.email}\n` : '\n') +
    (res.matched > 0
      ? `Se envió a ${res.enviados} veterinario${res.enviados === 1 ? '' : 's'} de la red en ${res.comunaCanon}.`
      : `⚠ Sin veterinarios disponibles para ${res.comunaCanon} en esa fecha/franja — requiere gestión manual.`)
  try { await avisarAdminsWhatsapp(avisoAdmin) } catch (e) { console.warn('[agente-acciones] FYI admin eutanasia falló:', e) }

  const precioTxt = cliente > 0
    ? ` El valor del servicio para el cliente es ${fmtPrecio(cliente)}${recargoFuera > 0 ? ` (incluye ${fmtPrecio(recargoFuera)} de recargo por ser fuera de horario, sobre ${fmtPrecio(precioBase)}). Avísale ese recargo con claridad al cliente` : ''}.`
    : ''

  // La HORA queda explícita en el resultado: el modelo debe confirmarle al cliente
  // exactamente la que se registró (nunca otra).
  const horaTxt = ` Quedó registrada para el ${formatDateConDia(a.fecha)} a las ${hora} hrs: confírmale esa MISMA fecha y hora al cliente (el día de la semana ya viene resuelto acá, no lo cambies).`

  // RETIRO: solo si la eutanasia viene CON cremación. La eutanasia la hace el vet
  // (por eso puede superponerse con nuestra agenda), pero el retiro es nuestro y
  // compite con la ruta del chofer. Si su media hora está topada, se corre al
  // primer hueco hábil y el cliente tiene que saberlo AHORA, no enterarse el día
  // del servicio (dueño 2026-08-05). Es una estimación: la hora definitiva la fija
  // el veterinario al coordinar con la familia.
  let retiroTxt = ''
  if (!sinCremacion) {
    try {
      const r = await retiroTrasEutanasia(a.fecha, hora)
      retiroTxt = r.desplazado
        ? ` IMPORTANTE, díselo al cliente: normalmente pasamos a retirar 30 minutos después del procedimiento (a las ${r.base}), pero a esa hora ya tenemos otro retiro comprometido, así que pasaríamos a las ${r.hora}. Explícaselo como lo que es —tenemos un tope de horario y lo tomamos en el primer horario libre después del procedimiento—, sin dramatizarlo, y aclara que la hora definitiva la confirma el veterinario al coordinar con él.`
        : ` Pasamos a retirar a las ${r.hora} (30 minutos después del procedimiento): coméntaselo al cliente, aclarando que la hora definitiva la confirma el veterinario al coordinar.`
    } catch (e) { console.warn('[agente-acciones] no se pudo proyectar el retiro:', e) }
  }

  if (res.matched === 0) {
    return `Registré la solicitud de eutanasia (N° ${res.id}) pero ahora mismo no hay veterinarios disponibles para ${res.comunaCanon} en esa fecha/franja. ` +
      `Dile al cliente que su solicitud quedó INGRESADA y que el equipo lo contactará a la brevedad para coordinar.${horaTxt}${retiroTxt}${precioTxt}`
  }
  return `Solicitud de eutanasia registrada (N° ${res.id}) y enviada a ${res.enviados} veterinario${res.enviados === 1 ? '' : 's'} de nuestra red en ${res.comunaCanon}. ` +
    `Dile al cliente que su solicitud quedó INGRESADA y que nos pondremos en contacto por este mismo medio apenas un veterinario confirme su disponibilidad.${horaTxt}${retiroTxt}${precioTxt}`
}

/**
 * Consulta "¿cuánto falta para el retiro?": avisa al admin (pidiéndole que
 * responda CITANDO el mensaje) y guarda el relay pendiente. Cuando el admin
 * responde, el webhook reenvía su respuesta al cliente. NO inventa una hora.
 */
async function consultarEtaRetiro(a: AccionConsultaEta, ctx: CtxAgente): Promise<string> {
  const waCliente = (ctx.waId || '').replace(/\D/g, '')
  if (!waCliente) {
    return 'Dile al cliente, cálido y breve, que ya vamos en camino y que le avisamos al chofer para que se ponga en contacto con él directamente para coordinar. NO inventes una hora.'
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
    return 'Dile al cliente, cálido y breve, que ya vamos en camino y que le avisamos al chofer para que se ponga en contacto con él directamente para coordinar. NO inventes una hora.'
  }
  try {
    await crearRelayPendiente({ adminMsgId: msgIds.join(','), clienteWaId: waCliente, clienteNombre: nombre, mascota, pregunta: 'ETA de retiro' })
  } catch (e) { console.warn('[agente-acciones] no se pudo guardar relay pendiente:', e) }

  return 'Avisé al equipo/chofer. Dile al cliente, cálido y breve, que ya vamos en camino y que le avisamos al chofer para que se ponga en contacto con él directamente para coordinar. NO inventes una hora.'
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
          entregaTxt = ` Fecha de entrega MÁXIMA: ${formatDateConDia(isoFecha(obj))} (hasta ${plazo} días HÁBILES desde el retiro${express ? ', con Servicio Express' : ''}; puede ser antes). El día de la semana de esa fecha es el que va acá: repítelo TAL CUAL, no lo calcules tú.`
        }
      }
    } catch { /* sin fecha disponible */ }
  }

  return `Datos REALES de la mascota (código ${c.codigo}): nombre "${nombre}", estado: ${estadoLegible}.${entregaTxt} ` +
    `Respóndele al cliente de forma cálida y clara contándole en qué parte del proceso está ${nombre}. ` +
    `Si preguntó por la fecha de entrega, dásela ACLARANDO que es en días hábiles. ` +
    `Si pregunta a qué HORA se hace la entrega, dile que no podemos confirmar una hora específica porque las rutas son largas, ` +
    `pero que le llegará un CORREO cuando vayamos en camino y le avisaremos cuando estemos próximos a llegar. NO escales por esto. ` +
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

  // Adicionales que YA tiene la ficha. Se CONSOLIDA por (tipo,id) en vez de
  // apilar líneas: el modelo re-ejecuta esta herramienta con facilidad (basta un
  // "gracias" del cliente) y cada repetición dejaba una línea nueva del mismo
  // producto. Caso Max (P174-CP, 29-07-2026): pidió UNA ánfora "Madera Patitas",
  // el bot ejecutó la venta 3 veces en 80 segundos (13:17, 13:18, 13:19) y la
  // ficha terminó con 3 líneas iguales → se le entregaron las cenizas en 3
  // ánforas y Bodega descontó 3 unidades.
  //
  // Regla: la llamada es IDEMPOTENTE. Si el producto ya está con esa cantidad (o
  // más), no se agrega nada. Solo si el modelo pide MÁS unidades de las que hay
  // se sube la cantidad, y únicamente esa diferencia se cobra y se descuenta de
  // stock. Así "quiero 2 ánforas" sigue funcionando, pero repetir la herramienta
  // no duplica nada.
  let adicionales: Array<{ tipo: string; id: string; nombre: string; precio: number; qty: number }> = []
  try { const x = JSON.parse(ficha.adicionales || '[]'); if (Array.isArray(x)) adicionales = x } catch { /* */ }
  const previos = adicionales.map(a => ({ ...a }))

  type ItemResuelto = typeof resueltos[number]
  const agregados: ItemResuelto[] = []   // el DELTA real (lo que se sumó ahora)
  const yaEstaban: string[] = []
  for (const r of resueltos) {
    const i = adicionales.findIndex(a => a.tipo === r.tipo && String(a.id) === String(r.id))
    if (i === -1) {
      adicionales.push({ tipo: r.tipo, id: r.id, nombre: r.nombre, precio: r.precio, qty: r.qty })
      agregados.push(r)
      continue
    }
    const actual = Math.max(1, Number(adicionales[i].qty) || 1)
    if (r.qty > actual) {
      adicionales[i] = { ...adicionales[i], nombre: r.nombre, precio: r.precio, qty: r.qty }
      agregados.push({ ...r, qty: r.qty - actual })
    } else {
      // Repetición: ya está agregado. No se toca la ficha ni se cobra de nuevo.
      yaEstaban.push(r.nombre)
    }
  }

  if (agregados.length === 0) {
    return `Esos productos YA ESTÁN agregados al servicio de ${ficha.nombre_mascota || 'la mascota'} (${yaEstaban.join(', ')}): no los agregué de nuevo ni se cobró nada extra. ` +
      `NO vuelvas a llamar esta herramienta para lo mismo. Respóndele al cliente de forma cálida y breve confirmando que ya quedó agregado. ` +
      `Solo si el cliente pide EXPRESAMENTE unidades ADICIONALES, vuelve a llamarla indicando la cantidad TOTAL que quiere.`
  }

  /**
   * Unidades COBRABLES por producto de una lista de adicionales, con la ánfora
   * premium incluida del CP ya descontada. Se evalúa sobre la lista COMPLETA de
   * la ficha (antes vs. después): si se evaluaba solo lo que entraba en la
   * llamada, cada ánfora nueva volvía a "consumir" la incluida y salía gratis.
   */
  const catMap = new Map<string, string>([
    ...prods.map(p => [String(p.id), String(p.categoria ?? '')] as [string, string]),
  ])
  const cobrablesDe = (lista: Array<{ tipo: string; id: string; precio: number; qty: number }>) => {
    const m = new Map<string, number>()
    for (const r of repartirAnforasPremium(ficha.codigo_servicio, lista, catMap)) {
      const k = `${r.item.tipo}:${r.item.id}`
      m.set(k, (m.get(k) ?? 0) + r.qtyCobrable)
    }
    return m
  }
  const cobrableAntes = cobrablesDe(previos)
  const cobrableDespues = cobrablesDe(adicionales)

  const snapInput = {
    peso: parseFloat(ficha.peso_ingreso || ficha.peso_declarado || '0') || 0,
    codigo_servicio: ficha.codigo_servicio || 'CI',
    veterinaria_id: ficha.veterinaria_id || undefined,
    tipo_precios: ficha.tipo_precios || undefined,
    descuento_tipo: ficha.descuento_tipo || undefined,
    descuento_valor: ficha.descuento_valor || undefined,
  }
  // ⚠️ El snapshot valoriza con `item.precio`: hay que pasarle el PRECIO de cada
  // adicional. Antes se mandaba solo {tipo,id,qty} → todo valía 0, así que cada
  // vez que el bot agregaba algo dejaba `precio_adicionales` en $0 y BORRABA lo
  // que la ficha ya tenía cobrado (a Max le borró el recargo de fuera de horario:
  // la ficha quedó en $175.000 cuando su boleta ya decía $185.000).
  const paraSnapshot = (lista: typeof adicionales) =>
    lista.map(x => ({ tipo: x.tipo as 'producto' | 'servicio', id: x.id, precio: x.precio, qty: x.qty }))

  try {
    const snapshot = await calcularSnapshotFicha({ ...snapInput, adicionales: paraSnapshot(adicionales) })
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

  // Descontar stock SOLO del delta (los 'servicio' no llevan stock).
  // Best-effort: no bloquea la venta.
  try { await ajustarStockAdicionales([], agregados.filter(r => r.tipo === 'producto')) }
  catch (e) { console.warn('[agente-acciones] agregarAdicional: stock no ajustado:', e) }

  // Cobro: correo (con datos de transferencia + botón confirmar) + WhatsApp.
  // Se cobra solo lo que pasó a ser cobrable con este delta — en Cremación
  // Premium la PRIMERA ánfora premium de la ficha va incluida, las siguientes no.
  const cobrables = agregados
    .map(r => {
      const k = `${r.tipo}:${r.id}`
      const delta = (cobrableDespues.get(k) ?? 0) - (cobrableAntes.get(k) ?? 0)
      return { ...r, qty: Math.min(r.qty, Math.max(0, delta)) }
    })
    .filter(r => r.qty > 0)
  const monto = cobrables.reduce((s, r) => s + r.precio * r.qty, 0)

  // ¿Se cobra APARTE (correo + WhatsApp con datos de transferencia) o el adicional
  // simplemente se suma al total del servicio? Solo se cobra aparte si el servicio
  // ya estaba CERRADO: la mascota retirada Y la ficha pagada o boleteada. Ver
  // `correspondeCobrarAdicional` en lib/cobros — ahí están los casos que lo
  // definieron (Mona, Channel, Mochi). `ficha` es la fila tal como estaba antes de
  // este cambio, que es justo el estado que hay que mirar.
  const cobrarAparte = correspondeCobrarAdicional(ficha, ficha, ahoraChile())

  if (cobrables.length > 0 && cobrarAparte) {
    try {
      await dispararCobroAdicional(
        { id: String(ficha.id), email: ficha.email || '', nombre_tutor: ficha.nombre_tutor || '', nombre_mascota: ficha.nombre_mascota || '', telefono: ficha.telefono || '' },
        cobrables.map(r => ({ nombre: r.nombre, precio: r.precio, qty: r.qty })),
      )
    } catch (e) { console.warn('[agente-acciones] agregarAdicional: cobro falló:', e) }
  }

  // El detalle describe el DELTA (lo que realmente se sumó), no lo pedido: si
  // parte ya estaba, decir que se agregó todo de nuevo sería mentirle al cliente.
  const detalle = agregados.map(r => `${r.qty > 1 ? `${r.qty}× ` : ''}${r.nombre}`).join(', ')
  const nota = yaEstaban.length > 0
    ? ` (${yaEstaban.join(', ')} ya estaba agregado de antes, no se duplicó ni se volvió a cobrar)`
    : ''
  if (cobrables.length === 0) {
    // Todo lo agregado venía incluido gratis (ej. ánfora premium de una Cremación
    // Premium): no se cobró nada, así que NO se envió correo de pago.
    return `Listo: agregué ${detalle} al servicio de ${ficha.nombre_mascota || 'la mascota'}, sin costo adicional (viene incluido en el servicio)${nota}. ` +
      `Confírmale de forma cálida y breve que quedó agregado, sin necesidad de pago adicional.`
  }
  if (!cobrarAparte) {
    // El servicio todavía no está cerrado: el adicional quedó dentro del total de
    // la ficha y se paga junto con todo lo demás (al retiro o cuando se salde).
    return `Listo: agregué ${detalle} al servicio de ${ficha.nombre_mascota || 'la mascota'} (${fmtPrecio(monto)})${nota}. ` +
      `Quedó sumado al total de su ficha y NO enviamos ningún cobro aparte: se paga junto con el resto del servicio. ` +
      `Confírmale de forma cálida y breve que quedó agregado y que va incluido en el total del servicio (NO le digas que le llegará un correo con datos de pago).`
  }
  return `Listo: agregué ${detalle} al servicio de ${ficha.nombre_mascota || 'la mascota'} (total a pagar ${fmtPrecio(monto)})${nota}. ` +
    `Le enviamos al cliente un correo con el detalle y los datos de transferencia (y un aviso por WhatsApp). ` +
    `Confírmale de forma cálida y breve que quedó agregado y que le llegó el correo con los datos para pagar.`
}

/** Handlers disponibles para el agente (Flujo A: retiro · Flujo B: eutanasia). */
export function handlersAgente(): HandlersAgente {
  return { solicitarRetiro, reprogramarRetiro, solicitarRetiroVet, cotizarCremacion, cotizarEutanasia, agendarEutanasia, consultarEtaRetiro, consultarEstadoMascota, enviarCatalogo, agregarAdicional, cancelarAgendamiento }
}
