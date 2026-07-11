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
 * Regla de agendamiento del bot (1 retiro por hora):
 *  - Ventana 09:00–21:00 (la ÚLTIMA hora para agendar un retiro es 21:00).
 *  - No se agenda dentro de la próxima hora (mínimo = hora actual de Chile + 1 h).
 *  - Un bloque horario ocupado no está disponible (bloqueo estricto).
 * Ocupan slot: los retiros (pendiente/confirmada) y las eutanasias que YA tienen
 * hora de retiro informada. Las eutanasias en amarillo (aún sin hora del vet)
 * son un marcador de franja y NO bloquean un retiro de cremación.
 */
import { getSheetData } from './datastore'
import { formatDateForSheet, formatHora } from './dates'

export const HORA_APERTURA = 9         // primera hora de la agenda (09:00)
export const HORA_ULTIMO_RETIRO = 21   // última hora para agendar un retiro (21:00)
const MIN_APERTURA = HORA_APERTURA * 60
const MIN_ULTIMO = HORA_ULTIMO_RETIRO * 60
const BUFFER_MIN = 60                   // no se agenda dentro de la próxima hora

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
}

/**
 * Items de la agenda en un rango [fromISO, toISO] (ambos opcionales, ISO). El
 * rango se compara como string ISO. Ordenados por fecha y hora.
 */
export async function listarAgenda(fromISO?: string, toISO?: string): Promise<AgendaItem[]> {
  const [retiros, cotis] = await Promise.all([
    getSheetData('solicitudes_retiro').catch(() => [] as Record<string, string>[]),
    getSheetData('cotizaciones_eutanasia').catch(() => [] as Record<string, string>[]),
  ])
  const inRange = (iso: string) => (!fromISO || iso >= fromISO) && (!toISO || iso <= toISO)
  const out: AgendaItem[] = []

  for (const r of retiros) {
    const estado = (r.estado || '').toLowerCase()
    if (estado !== 'pendiente' && estado !== 'confirmada') continue
    const fecha = formatDateForSheet(r.fecha_retiro)
    if (!fecha || !inRange(fecha)) continue
    const min = horaMin(r.hora_retiro)
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
    })
  }

  for (const c of cotis) {
    const estado = (c.estado || '').toLowerCase()
    if (!['creada', 'enviada', 'aceptada', 'realizada'].includes(estado)) continue
    const fecha = formatDateForSheet(c.fecha_servicio)
    if (!fecha || !inRange(fecha)) continue
    const horaRetiro = (c.hora_retiro_crematorio || '').trim()
    const tieneRetiro = !!horaRetiro
    const min = horaMin(tieneRetiro ? horaRetiro : c.hora_servicio)
    out.push({
      id: `e${c.id}`,
      tipo: 'eutanasia',
      fecha,
      hora: min != null ? fmtMin(min) : '',
      bloque: bloqueDe(min),
      estado: tieneRetiro ? 'confirmada' : 'pendiente',
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

/** Bloques horarios (hora entera) ocupados en una fecha, para el bloqueo del bot. */
async function ocupadosDe(fechaISO: string): Promise<Set<number>> {
  const items = await listarAgenda(fechaISO, fechaISO)
  const set = new Set<number>()
  for (const it of items) {
    if (it.bloque < HORA_APERTURA || it.bloque > HORA_ULTIMO_RETIRO) continue
    // Retiros siempre ocupan; eutanasias solo cuando ya tienen hora de retiro.
    if (it.tipo === 'retiro') set.add(it.bloque)
    else if (it.tipo === 'eutanasia' && !it.esperandoHoraVet) set.add(it.bloque)
  }
  return set
}

/**
 * Horas libres (HH:MM) sugeribles en una fecha, respetando ventana + buffer.
 * Recorre TODA la ventana 09:00–21:00 (antes se cortaba a las primeras 5 horas
 * libres, lo que escondía la tarde completa cuando la mañana ya tenía 5+ bloques
 * libres — bug real: a un cliente solo se le ofreció hasta las 14:00 habiendo
 * horas libres hasta las 21:00).
 */
function horasLibres(fechaISO: string, hoy: string, ahora: number, ocupados: Set<number>): string[] {
  if (fechaISO < hoy) return []
  const esHoy = fechaISO === hoy
  const startMin = esHoy ? Math.max(MIN_APERTURA, ahora + BUFFER_MIN) : MIN_APERTURA
  const libres: string[] = []
  let cursor = startMin
  while (cursor <= MIN_ULTIMO) {
    const blk = Math.floor(cursor / 60)
    if (!ocupados.has(blk)) libres.push(fmtMin(cursor))
    cursor = (blk + 1) * 60   // avanza a la próxima hora en punto
  }
  return libres
}

export interface EvalSlot {
  ok: boolean
  motivo?: string
  /** Horas libres ese día (HH:MM) para ofrecer al cliente. */
  libres: string[]
}

/**
 * Valida si se puede agendar un retiro en (fecha, hora): ventana 09:00–21:00,
 * fuera de la próxima hora si es hoy, y con el bloque horario libre (1 retiro por
 * hora). Devuelve además las horas libres de ese día.
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

  if (ocupados.has(bloqueDe(min)))
    return { ok: false, motivo: `El horario de las ${fmtMin(min)} del ${fecha} ya está tomado (solo un retiro por hora).`, libres }

  return { ok: true, libres }
}
