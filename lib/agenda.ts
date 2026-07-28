/**
 * Agenda de retiros/servicios: capa compartida entre la vista semanal del
 * dashboard (components/AgendaSemanal) y el agendamiento del bot de WhatsApp
 * (lib/agente-acciones). Fuentes:
 *  - `solicitudes_retiro` (retiros de cremación del bot): amarillo mientras
 *    están 'pendiente', verde al 'confirmada'.
 *  - `cotizaciones_eutanasia` (eutanasia a domicilio): en la agenda se muestra
 *    el RETIRO DEL CREMATORIO (el chofer), no la hora de la eutanasia. Amarillo
 *    en la hora del servicio mientras el vet NO informa la hora de retiro; verde
 *    en la hora de retiro (`hora_retiro_crematorio`) cuando la informa.
 *
 * Regla de agendamiento del bot (decisión del dueño 2026-07-11, actualizada 2026-07-23):
 *  - Ventana 09:00–21:10 (la ÚLTIMA hora para agendar un retiro es 21:10).
 *  - No se agenda dentro de la próxima hora (mínimo = hora actual de Chile + 1 h).
 *  - SEPARACIÓN ASIMÉTRICA (dueño 2026-07-24): una reserva bloquea los 30 min
 *    ANTES y los 45 min DESPUÉS de su hora. Ej.: una reserva a las 16:00 permite
 *    un nuevo retiro a las 15:30 (30 min antes) pero nada entre 15:31 y 16:44.
 *    Se compara al MINUTO, no por bloque.
 * Ocupan slot TODAS las reservas visibles de la agenda:
 *  - retiros (pendiente/confirmada) a su hora;
 *  - eutanasias SIEMPRE: a la hora del SERVICIO mientras el vet no informa la
 *    hora de retiro, y a la HORA DE RETIRO (`hora_retiro_crematorio`) cuando la
 *    informa — el bloqueo se "reajusta" solo (ej.: eutanasia 15:00 bloquea hasta
 *    las 16:00; el vet confirma retiro 16:00 → pasa a bloquear hasta las 17:00).
 *
 * BLOQUEOS MANUALES (`agenda_bloqueos`, botón "Bloquear agenda" del dashboard):
 * rangos fecha/hora que el equipo cierra a mano (mantención, feriado propio, un
 * viaje del chofer…). Dentro de un bloqueo el bot NO agenda ni ofrece horarios;
 * el rango es [inicio, fin) → se puede agendar justo A la hora de término.
 */
import { getSheetData } from './datastore'
import { formatDateForSheet, formatHora } from './dates'
import { incluyeCremacion } from './eutanasia-cremacion'
import { crearEstimadorFichas, valorFicha, type EstimacionFicha } from './precio-estimado'
import { getConfigCobroEutanasia, cobroClienteCon, type ConfigCobroEutanasia } from './eutanasia-precios'

export const HORA_APERTURA = 9         // primera hora de la agenda (09:00)
export const HORA_ULTIMO_RETIRO = 21   // hora de referencia de la agenda; el corte real es 21:10
const MIN_APERTURA = HORA_APERTURA * 60
const MIN_ULTIMO = 21 * 60 + 10        // 21:10 — última hora agendable (decisión dueño 2026-07-23)
const SEP_ANTES = 30                   // bloqueo ANTES de una reserva (dueño 2026-07-24)
const SEP_DESPUES = 45                 // bloqueo DESPUÉS de una reserva
const SEPARACION_MIN = SEP_DESPUES     // paso de la grilla de horas ofrecidas
const BUFFER_MIN = 60                   // no se agenda dentro de la próxima hora (lead time del chofer)
// Eutanasia: el vet informa la hora de la VISITA (acordada con el cliente) y
// nuestro chofer pasa a retirar ~30 min después → la agenda muestra ese desfase.
const DESFASE_RETIRO_MIN = 30

const TZ = 'America/Santiago'

/** Fecha (ISO) y minutos desde medianoche AHORA en zona de Chile. */
export function ahoraChile(): { iso: string; min: number } {
  const now = new Date()
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const hhmm = new Intl.DateTimeFormat('es-CL', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
  const [h, m] = hhmm.split(':').map(Number)
  return { iso, min: (h || 0) * 60 + (m || 0) }
}

function horaMin(raw: unknown): number | null {
  const s = formatHora(raw as string)
  if (!s) return null
  const [h, m] = s.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
}
function fmtMin(min: number): string {
  const h = Math.floor(min / 60), m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
function bloqueDe(min: number | null): number {
  return min == null ? -1 : Math.floor(min / 60)
}

// ── Bloqueos manuales de agenda (tabla `agenda_bloqueos`) ────────────────────

export const SHEET_BLOQUEOS = 'agenda_bloqueos'

export interface BloqueoAgenda {
  id: string
  /** ISO YYYY-MM-DD */
  desde: string
  /** HH:MM (00:00 si el bloqueo arranca al inicio del día) */
  horaDesde: string
  /** ISO YYYY-MM-DD */
  hasta: string
  /** HH:MM (24:00 → se guarda como 23:59 desde la UI si es todo el día) */
  horaHasta: string
  motivo: string
  creadoPor: string
  fechaCreacion: string
}

/** Rango de minutos bloqueado dentro de UN día. */
export interface RangoBloqueado { ini: number; fin: number; motivo: string; id: string }

function normalizarBloqueo(r: Record<string, string>): BloqueoAgenda | null {
  const desde = formatDateForSheet(r.fecha_inicio)
  const hasta = formatDateForSheet(r.fecha_fin) || desde
  if (!desde || !hasta) return null
  return {
    id: String(r.id ?? ''),
    desde,
    hasta: hasta < desde ? desde : hasta,
    horaDesde: formatHora(r.hora_inicio) || '00:00',
    horaHasta: formatHora(r.hora_fin) || '23:59',
    motivo: r.motivo || '',
    creadoPor: r.creado_por || '',
    fechaCreacion: r.fecha_creacion || '',
  }
}

/**
 * Bloqueos que se cruzan con el rango [fromISO, toISO] (ambos opcionales).
 * Best-effort: si la tabla todavía no existe devuelve [] (la agenda sigue viva).
 */
export async function listarBloqueos(fromISO?: string, toISO?: string): Promise<BloqueoAgenda[]> {
  const rows = await getSheetData(SHEET_BLOQUEOS).catch(() => [] as Record<string, string>[])
  return rows
    .filter(r => (r.activo || 'TRUE').toUpperCase() !== 'FALSE')
    .map(normalizarBloqueo)
    .filter((b): b is BloqueoAgenda => !!b)
    .filter(b => (!toISO || b.desde <= toISO) && (!fromISO || b.hasta >= fromISO))
    .sort((a, b) => a.desde.localeCompare(b.desde) || a.horaDesde.localeCompare(b.horaDesde))
}

/**
 * Recorta los bloqueos a los minutos que tapan de UNA fecha. Un bloqueo de
 * varios días tapa los días intermedios completos.
 */
export function rangosDelDia(bloqueos: BloqueoAgenda[], fechaISO: string): RangoBloqueado[] {
  const out: RangoBloqueado[] = []
  for (const b of bloqueos) {
    if (fechaISO < b.desde || fechaISO > b.hasta) continue
    const ini = fechaISO === b.desde ? (horaMin(b.horaDesde) ?? 0) : 0
    const fin = fechaISO === b.hasta ? (horaMin(b.horaHasta) ?? 24 * 60) : 24 * 60
    if (fin > ini) out.push({ ini, fin, motivo: b.motivo, id: b.id })
  }
  return out.sort((a, b) => a.ini - b.ini)
}

/** El rango que tapa `min`, o null. Intervalo [ini, fin): la hora de término ya es agendable. */
function bloqueadoEn(min: number, rangos: RangoBloqueado[]): RangoBloqueado | null {
  return rangos.find(r => min >= r.ini && min < r.fin) || null
}

export interface AgendaItem {
  id: string
  tipo: 'retiro' | 'eutanasia'
  fecha: string            // ISO YYYY-MM-DD
  hora: string             // HH:MM del bloque mostrado
  bloque: number           // hora entera (9..21) o -1 si no hay hora válida
  estado: 'pendiente' | 'confirmada'   // amarillo | verde
  mascota: string
  quien: string
  esVet: boolean
  comuna: string
  direccion: string
  tipo_servicio?: string
  clienteId?: string
  /** Eutanasia: hora del servicio de eutanasia (referencia). */
  horaEutanasia?: string
  /** Eutanasia: true si aún no llega la hora de retiro del veterinario. */
  esperandoHoraVet?: boolean
  /** Eutanasia SIN cremación: solo recordatorio (etiqueta gris), NO bloquea la agenda. */
  sinCremacion?: boolean
  /** Valor a cobrar por lo agendado (cremación + eutanasia si corresponde). */
  valor?: number
  /** true mientras el precio no esté congelado en la ficha (es una estimación). */
  valorEstimado?: boolean
}

/**
 * Items de la agenda en un rango [fromISO, toISO] (ambos opcionales, ISO). El
 * rango se compara como string ISO. Ordenados por fecha y hora.
 *
 * `conValor` agrega el valor a cobrar de cada agendamiento (lee las tablas de
 * precios): lo pide la vista del dashboard. El chequeo de slots del bot NO lo
 * usa — así el agendamiento no paga esas lecturas extra.
 */
export async function listarAgenda(
  fromISO?: string,
  toISO?: string,
  opts: { conValor?: boolean } = {},
): Promise<AgendaItem[]> {
  const [retiros, cotis, clientes] = await Promise.all([
    getSheetData('solicitudes_retiro').catch(() => [] as Record<string, string>[]),
    getSheetData('cotizaciones_eutanasia').catch(() => [] as Record<string, string>[]),
    getSheetData('clientes').catch(() => [] as Record<string, string>[]),
  ])
  const clientePorId = new Map(clientes.map(c => [String(c.id), c]))
  const inRange = (iso: string) => (!fromISO || iso >= fromISO) && (!toISO || iso <= toISO)
  const out: AgendaItem[] = []

  // Valor a cobrar de cada agendamiento: el precio congelado de la ficha si ya
  // lo tiene, si no la estimación en vivo (fichas "por ingresar" y solicitudes
  // que todavía no generaron ficha). Best-effort: si falla, la agenda sale sin
  // montos. Ver lib/precio-estimado.
  let estimar: ((row: Record<string, string>) => EstimacionFicha) | null = null
  let cfgEut: ConfigCobroEutanasia | null = null
  if (opts.conValor) {
    try {
      [estimar, cfgEut] = await Promise.all([crearEstimadorFichas(), getConfigCobroEutanasia()])
    } catch (e) { console.warn('[agenda] sin estimación de precios:', e) }
  }
  const valorDe = (ficha: Record<string, string> | undefined, fallback: Record<string, string>) => {
    if (!estimar) return {}
    const v = ficha ? valorFicha(ficha, estimar) : { total: estimar(fallback).total, estimado: true }
    return { valor: v.total, valorEstimado: v.estimado }
  }
  /** Eutanasia: lo que se cobra por la eutanasia (fuera de boleta) + la cremación. */
  const valorEutanasia = (cot: Record<string, string>) => {
    if (!cfgEut) return {}
    const eut = cobroClienteCon(cot, cfgEut).total
    const ficha = cot.cliente_id ? clientePorId.get(String(cot.cliente_id)) : undefined
    const crem = ficha && estimar ? valorFicha(ficha, estimar) : null
    return { valor: eut + (crem?.total ?? 0), valorEstimado: crem ? crem.estimado : true }
  }

  for (const r of retiros) {
    const estado = (r.estado || '').toLowerCase()
    if (estado !== 'pendiente' && estado !== 'confirmada') continue
    // Si la solicitud ya tiene ficha vinculada (borrador o registrada), la FICHA
    // es la fuente de verdad de fecha/hora: el equipo puede haberla corregido a
    // mano y ese cambio debe verse en la agenda (la solicitud es solo el snapshot
    // del bot). Se usa `||` porque las celdas vacías llegan como '' (no null).
    const ficha = r.cliente_id ? clientePorId.get(String(r.cliente_id)) : undefined
    const fecha = formatDateForSheet((ficha?.fecha_retiro || r.fecha_retiro))
    if (!fecha || !inRange(fecha)) continue
    const min = horaMin(ficha?.hora_retiro || r.hora_retiro)
    const esVet = r.origen === 'bot_vet' || !!r.vet_nombre
    out.push({
      id: `r${r.id}`,
      tipo: 'retiro',
      fecha,
      hora: min != null ? fmtMin(min) : '',
      bloque: bloqueDe(min),
      estado: estado === 'confirmada' ? 'confirmada' : 'pendiente',
      mascota: r.nombre_mascota || '',
      quien: esVet ? (r.vet_nombre || 'Veterinario') : (r.cliente_nombre || ''),
      esVet,
      comuna: r.comuna || '',
      direccion: r.direccion || '',
      tipo_servicio: r.tipo_servicio || '',
      clienteId: r.cliente_id || '',
      ...valorDe(ficha, {
        peso_declarado: r.peso || '',
        codigo_servicio: r.tipo_servicio || '',
        veterinaria_id: r.veterinaria_id || '',
        comuna: r.comuna || '',
        fecha_retiro: r.fecha_retiro || '',
        hora_retiro: r.hora_retiro || '',
        adicionales: '[]',
      }),
    })
  }

  for (const c of cotis) {
    const estado = (c.estado || '').toLowerCase()
    if (!['creada', 'enviada', 'aceptada', 'realizada'].includes(estado)) continue
    const fecha = formatDateForSheet(c.fecha_servicio)
    if (!fecha || !inRange(fecha)) continue

    // SIN cremación: no hay retiro del crematorio → solo un recordatorio (gris) a
    // la hora de la EUTANASIA. No entra en el cálculo de slots ocupados (ver
    // ocupadosDe), así que no bloquea la agenda del chofer.
    if (!incluyeCremacion(c)) {
      const min = horaMin(c.hora_servicio)
      out.push({
        id: `e${c.id}`,
        tipo: 'eutanasia',
        fecha,
        hora: min != null ? fmtMin(min) : '',
        bloque: bloqueDe(min),
        estado: 'pendiente',
        mascota: c.mascota_nombre || '',
        quien: c.cliente_nombre || '',
        esVet: false,
        comuna: c.comuna || '',
        direccion: c.direccion || '',
        clienteId: c.cliente_id || '',
        horaEutanasia: formatHora(c.hora_servicio) || '',
        esperandoHoraVet: false,
        sinCremacion: true,
        ...valorEutanasia(c),
      })
      continue
    }

    const horaRetiro = (c.hora_retiro_crematorio || '').trim()
    const tieneRetiro = !!horaRetiro
    const realizada = estado === 'realizada'
    // El vet informa la hora ACORDADA con el cliente (la visita); nuestro chofer
    // pasa a retirar ~30 min después. La agenda del crematorio muestra ese +30.
    const baseMin = horaMin(tieneRetiro ? horaRetiro : c.hora_servicio)
    const min = (baseMin != null && tieneRetiro) ? baseMin + DESFASE_RETIRO_MIN : baseMin
    out.push({
      id: `e${c.id}`,
      tipo: 'eutanasia',
      fecha,
      hora: min != null ? fmtMin(min) : '',
      bloque: bloqueDe(min),
      // Verde (confirmada) si ya sabemos la hora de retiro O si la eutanasia ya se realizó.
      estado: (tieneRetiro || realizada) ? 'confirmada' : 'pendiente',
      mascota: c.mascota_nombre || '',
      quien: c.cliente_nombre || '',
      esVet: false,
      comuna: c.comuna || '',
      direccion: c.direccion || '',
      clienteId: c.cliente_id || '',
      horaEutanasia: formatHora(c.hora_servicio) || '',
      esperandoHoraVet: !tieneRetiro,
      ...valorEutanasia(c),
    })
  }

  return out.sort((a, b) =>
    a.fecha.localeCompare(b.fecha) || (a.hora || '').localeCompare(b.hora || ''))
}

/**
 * Minutos de inicio de TODAS las reservas de una fecha (retiros + eutanasias,
 * con o sin hora de retiro informada), para el bloqueo del bot al minuto.
 */
async function ocupadosDe(fechaISO: string): Promise<number[]> {
  const items = await listarAgenda(fechaISO, fechaISO)
  const out: number[] = []
  for (const it of items) {
    // Las eutanasias SIN cremación no ocupan slot: el chofer no pasa a retirar,
    // así que su horario queda libre para agendar otros retiros.
    if (it.tipo === 'eutanasia' && it.sinCremacion) continue
    const min = horaMin(it.hora)
    if (min != null) out.push(min)
  }
  return out
}

/**
 * true si `min` cae dentro del bloqueo de alguna reserva existente `o`. Asimétrico
 * (dueño 2026-07-24): cada reserva bloquea 30 min ANTES y 45 min DESPUÉS de su hora
 * → chocan los `min` con `o - 30 < min < o + 45`. Los `<` son estrictos A PROPÓSITO:
 * se permite exactamente 30 min antes y 45 min después (agendar pegadas).
 */
function choca(min: number, ocupados: number[]): boolean {
  return ocupados.some(o => min > o - SEP_ANTES && min < o + SEP_DESPUES)
}

/**
 * Horas libres (HH:MM) sugeribles en una fecha, respetando ventana + buffer.
 * Recorre TODA la ventana 09:00–21:10 (antes se cortaba a las primeras 5 horas
 * libres, lo que escondía la tarde completa cuando la mañana ya tenía 5+ bloques
 * libres — bug real: a un cliente solo se le ofreció hasta las 14:00 habiendo
 * horas libres hasta las 21:10). Candidatos: el arranque, una grilla cada 45 min
 * anclada a la apertura (09:00, 09:45, 10:30, …), el corte 21:10 (siempre como
 * última hora), cada `reserva + 45 min` (así, con una reserva a las 16:30, se
 * ofrece 17:15 en vez de perder la franja) y cada `reserva - 30 min` (el hueco que
 * queda justo antes). Se filtran los que chocan con el bloqueo (30 antes / 45 después)
 * y los que caen dentro de un BLOQUEO MANUAL de la agenda (se ofrece, eso sí, la
 * hora justo en que el bloqueo termina).
 */
function horasLibres(fechaISO: string, hoy: string, ahora: number, ocupados: number[], rangos: RangoBloqueado[] = []): string[] {
  if (fechaISO < hoy) return []
  const esHoy = fechaISO === hoy
  const startMin = esHoy ? Math.max(MIN_APERTURA, ahora + BUFFER_MIN) : MIN_APERTURA
  const candidatos = new Set<number>([startMin, MIN_ULTIMO])
  // Grilla cada 45 min desde la apertura; se omiten los puntos a menos de 45 min
  // del cierre para no encimar 21:00 con el corte 21:10 (que siempre se ofrece).
  for (let m = MIN_APERTURA; m <= MIN_ULTIMO; m += SEPARACION_MIN) {
    if (m === MIN_ULTIMO || MIN_ULTIMO - m >= SEPARACION_MIN) candidatos.add(m)
  }
  for (const o of ocupados) { candidatos.add(o + SEP_DESPUES); candidatos.add(o - SEP_ANTES) }
  for (const r of rangos) candidatos.add(r.fin)   // el hueco apenas se libera el bloqueo
  return [...candidatos]
    .filter(min => min >= startMin && min <= MIN_ULTIMO && !choca(min, ocupados) && !bloqueadoEn(min, rangos))
    .sort((a, b) => a - b)
    .map(fmtMin)
}

export interface EvalSlot {
  ok: boolean
  motivo?: string
  /** Horas libres ese día (HH:MM) para ofrecer al cliente. */
  libres: string[]
}

/**
 * Primera hora libre de una FRANJA (AM/PM) en una fecha, para el agendamiento de
 * eutanasias del bot (el cliente elige franja, no hora exacta; la hora resultante
 * también debe respetar los 45 min con las demás reservas). Corte AM/PM a las
 * 13:00, igual que el matcher de vets. Preferencia: lo más cerca de la hora
 * representativa histórica (10:00 AM / 16:00 PM).
 */
export async function horaLibreEnFranja(fechaRaw: string, franja: 'AM' | 'PM'): Promise<{ hora: string | null; libresFranja: string[] }> {
  const fecha = formatDateForSheet(fechaRaw) || String(fechaRaw || '').trim()
  const { iso: hoy, min: ahora } = ahoraChile()
  const [ocupados, bloqueos] = await Promise.all([ocupadosDe(fecha), listarBloqueos(fecha, fecha)])
  const libres = horasLibres(fecha, hoy, ahora, ocupados, rangosDelDia(bloqueos, fecha))
  const libresFranja = libres.filter(h => {
    const hh = parseInt(h, 10)
    return franja === 'AM' ? hh < 13 : hh >= 13
  })
  const ref = (franja === 'AM' ? 10 : 16) * 60
  const orden = [...libresFranja].sort((a, b) => Math.abs((horaMin(a) ?? 0) - ref) - Math.abs((horaMin(b) ?? 0) - ref))
  return { hora: orden[0] || null, libresFranja }
}

/**
 * Valida si se puede agendar un retiro en (fecha, hora): ventana 09:00–21:10,
 * fuera de la próxima hora si es hoy, fuera de los bloqueos manuales de la agenda,
 * y respetando la separación con las demás reservas (30 min antes / 45 después).
 * Devuelve además las horas libres de ese día.
 */
export async function evaluarSlotRetiro(fechaRaw: string, horaRaw: string): Promise<EvalSlot> {
  const fecha = formatDateForSheet(fechaRaw) || String(fechaRaw || '').trim()
  const { iso: hoy, min: ahora } = ahoraChile()
  const [ocupados, bloqueos] = await Promise.all([ocupadosDe(fecha), listarBloqueos(fecha, fecha)])
  const rangos = rangosDelDia(bloqueos, fecha)
  const libres = horasLibres(fecha, hoy, ahora, ocupados, rangos)

  if (!fecha) return { ok: false, motivo: 'No indicaste una fecha válida.', libres }
  if (fecha < hoy) return { ok: false, motivo: `La fecha ${fecha} ya pasó.`, libres }

  const min = horaMin(horaRaw)
  if (min == null) return { ok: false, motivo: 'La hora no es válida (usa formato HH:MM).', libres }
  if (min < MIN_APERTURA || min > MIN_ULTIMO)
    return { ok: false, motivo: 'Los retiros se agendan entre las 09:00 y las 21:10 (la última hora para agendar es 21:10).', libres }

  if (fecha === hoy && min < ahora + BUFFER_MIN) {
    const desde = Math.min(MIN_ULTIMO, ahora + BUFFER_MIN)
    const msg = ahora + BUFFER_MIN > MIN_ULTIMO
      ? 'Ya no quedan horarios para hoy (no se agenda dentro de la próxima hora y la última hora es 21:10).'
      : `No podemos agendar dentro de la próxima hora. Para hoy, lo más pronto es a partir de las ${fmtMin(desde)}.`
    return { ok: false, motivo: msg, libres }
  }

  // Bloqueo manual del equipo: no se agenda dentro del rango. El motivo interno
  // NO se expone (el mensaje viaja al bot y de ahí al cliente).
  const bloq = bloqueadoEn(min, rangos)
  if (bloq) {
    const franja = bloq.ini <= 0 && bloq.fin >= 24 * 60
      ? 'todo ese día'
      : `de ${fmtMin(bloq.ini)} a ${fmtMin(bloq.fin)}`
    return { ok: false, motivo: `El horario de las ${fmtMin(min)} del ${fecha} no está disponible: tenemos la agenda cerrada ${franja}.`, libres }
  }

  if (choca(min, ocupados))
    return { ok: false, motivo: `El horario de las ${fmtMin(min)} del ${fecha} no está disponible: queda muy pegado a otra reserva (dejamos al menos 30 minutos antes y 45 minutos después de cada servicio agendado).`, libres }

  return { ok: true, libres }
}
