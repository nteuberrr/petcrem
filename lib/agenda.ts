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
 * Regla de agendamiento del bot (decisión del dueño 2026-07-11):
 *  - Ventana 09:00–21:00 (la ÚLTIMA hora para agendar un retiro es 21:00).
 *  - No se agenda dentro de la próxima hora (mínimo = hora actual de Chile + 1 h).
 *  - MÍNIMO 60 MINUTOS entre reservas: una reserva a las 16:00 bloquea todo
 *    nuevo agendamiento antes de las 17:00 (y simétrico: tampoco 15:30, porque
 *    quedaría a menos de una hora). Se compara al MINUTO, no por bloque.
 * Ocupan slot TODAS las reservas visibles de la agenda:
 *  - retiros (pendiente/confirmada) a su hora;
 *  - eutanasias SIEMPRE: a la hora del SERVICIO mientras el vet no informa la
 *    hora de retiro, y a la HORA DE RETIRO (`hora_retiro_crematorio`) cuando la
 *    informa — el bloqueo se "reajusta" solo (ej.: eutanasia 15:00 bloquea hasta
 *    las 16:00; el vet confirma retiro 16:00 → pasa a bloquear hasta las 17:00).
 */
import { getSheetData } from './datastore'
import { formatDateForSheet, formatHora } from './dates'
import { incluyeCremacion } from './eutanasia-cremacion'

export const HORA_APERTURA = 9         // primera hora de la agenda (09:00)
export const HORA_ULTIMO_RETIRO = 21   // última hora para agendar un retiro (21:00)
const MIN_APERTURA = HORA_APERTURA * 60
const MIN_ULTIMO = HORA_ULTIMO_RETIRO * 60
const BUFFER_MIN = 60                   // no se agenda dentro de la próxima hora
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
}

/**
 * Items de la agenda en un rango [fromISO, toISO] (ambos opcionales, ISO). El
 * rango se compara como string ISO. Ordenados por fecha y hora.
 */
export async function listarAgenda(fromISO?: string, toISO?: string): Promise<AgendaItem[]> {
  const [retiros, cotis, clientes] = await Promise.all([
    getSheetData('solicitudes_retiro').catch(() => [] as Record<string, string>[]),
    getSheetData('cotizaciones_eutanasia').catch(() => [] as Record<string, string>[]),
    getSheetData('clientes').catch(() => [] as Record<string, string>[]),
  ])
  const clientePorId = new Map(clientes.map(c => [String(c.id), c]))
  const inRange = (iso: string) => (!fromISO || iso >= fromISO) && (!toISO || iso <= toISO)
  const out: AgendaItem[] = []

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

/** true si `min` queda a menos de 60 minutos de alguna reserva existente. */
function choca(min: number, ocupados: number[]): boolean {
  return ocupados.some(o => Math.abs(o - min) < BUFFER_MIN)
}

/**
 * Horas libres (HH:MM) sugeribles en una fecha, respetando ventana + buffer.
 * Recorre TODA la ventana 09:00–21:00 (antes se cortaba a las primeras 5 horas
 * libres, lo que escondía la tarde completa cuando la mañana ya tenía 5+ bloques
 * libres — bug real: a un cliente solo se le ofreció hasta las 14:00 habiendo
 * horas libres hasta las 21:00). Candidatos: el arranque, cada hora en punto y
 * cada `reserva + 60 min` (así, con una reserva a las 16:30, se ofrece 17:30 en
 * vez de perder la franja hasta las 18:00). Se filtran los que chocan (<60 min
 * de otra reserva).
 */
function horasLibres(fechaISO: string, hoy: string, ahora: number, ocupados: number[]): string[] {
  if (fechaISO < hoy) return []
  const esHoy = fechaISO === hoy
  const startMin = esHoy ? Math.max(MIN_APERTURA, ahora + BUFFER_MIN) : MIN_APERTURA
  const candidatos = new Set<number>([startMin])
  for (let h = Math.ceil(startMin / 60); h * 60 <= MIN_ULTIMO; h++) candidatos.add(h * 60)
  for (const o of ocupados) candidatos.add(o + BUFFER_MIN)
  return [...candidatos]
    .filter(min => min >= startMin && min <= MIN_ULTIMO && !choca(min, ocupados))
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
 * también debe respetar los 60 min con las demás reservas). Corte AM/PM a las
 * 13:00, igual que el matcher de vets. Preferencia: lo más cerca de la hora
 * representativa histórica (10:00 AM / 16:00 PM).
 */
export async function horaLibreEnFranja(fechaRaw: string, franja: 'AM' | 'PM'): Promise<{ hora: string | null; libresFranja: string[] }> {
  const fecha = formatDateForSheet(fechaRaw) || String(fechaRaw || '').trim()
  const { iso: hoy, min: ahora } = ahoraChile()
  const ocupados = await ocupadosDe(fecha)
  const libres = horasLibres(fecha, hoy, ahora, ocupados)
  const libresFranja = libres.filter(h => {
    const hh = parseInt(h, 10)
    return franja === 'AM' ? hh < 13 : hh >= 13
  })
  const ref = (franja === 'AM' ? 10 : 16) * 60
  const orden = [...libresFranja].sort((a, b) => Math.abs((horaMin(a) ?? 0) - ref) - Math.abs((horaMin(b) ?? 0) - ref))
  return { hora: orden[0] || null, libresFranja }
}

/**
 * Valida si se puede agendar un retiro en (fecha, hora): ventana 09:00–21:00,
 * fuera de la próxima hora si es hoy, y a 60+ minutos de cualquier otra reserva
 * (retiro o eutanasia). Devuelve además las horas libres de ese día.
 */
export async function evaluarSlotRetiro(fechaRaw: string, horaRaw: string): Promise<EvalSlot> {
  const fecha = formatDateForSheet(fechaRaw) || String(fechaRaw || '').trim()
  const { iso: hoy, min: ahora } = ahoraChile()
  const ocupados = await ocupadosDe(fecha)
  const libres = horasLibres(fecha, hoy, ahora, ocupados)

  if (!fecha) return { ok: false, motivo: 'No indicaste una fecha válida.', libres }
  if (fecha < hoy) return { ok: false, motivo: `La fecha ${fecha} ya pasó.`, libres }

  const min = horaMin(horaRaw)
  if (min == null) return { ok: false, motivo: 'La hora no es válida (usa formato HH:MM).', libres }
  if (min < MIN_APERTURA || min > MIN_ULTIMO)
    return { ok: false, motivo: 'Los retiros se agendan entre las 09:00 y las 21:00 (la última hora para agendar es 21:00).', libres }

  if (fecha === hoy && min < ahora + BUFFER_MIN) {
    const desde = Math.min(MIN_ULTIMO, ahora + BUFFER_MIN)
    const msg = ahora + BUFFER_MIN > MIN_ULTIMO
      ? 'Ya no quedan horarios para hoy (no se agenda dentro de la próxima hora y la última hora es 21:00).'
      : `No podemos agendar dentro de la próxima hora. Para hoy, lo más pronto es a partir de las ${fmtMin(desde)}.`
    return { ok: false, motivo: msg, libres }
  }

  if (choca(min, ocupados))
    return { ok: false, motivo: `El horario de las ${fmtMin(min)} del ${fecha} no está disponible: queda a menos de 1 hora de otra reserva (dejamos al menos 1 hora entre cada servicio agendado).`, libres }

  return { ok: true, libres }
}
