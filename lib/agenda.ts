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
import { getSheetData, getRowsByIds } from './datastore'
import { formatDateForSheet, formatHora } from './dates'
import { incluyeCremacion } from './eutanasia-cremacion'
import { crearEstimadorFichas, valorFicha, type EstimacionFicha } from './precio-estimado'
import { getConfigCobroEutanasia, cobroClienteCon, type ConfigCobroEutanasia } from './eutanasia-precios'
import { fichaIngresada } from './ficha-retiro'

export const HORA_APERTURA = 9         // primera hora de la agenda (09:00)
export const HORA_ULTIMO_RETIRO = 21   // hora de referencia de la agenda; el corte real es 21:10
const MIN_APERTURA = HORA_APERTURA * 60
const MIN_ULTIMO = 21 * 60 + 10        // 21:10 — última hora agendable (decisión dueño 2026-07-23)
const SEP_ANTES = 30                   // bloqueo ANTES de una reserva (dueño 2026-07-24)
const SEP_DESPUES = 45                 // bloqueo DESPUÉS de una reserva
const SEPARACION_MIN = SEP_DESPUES     // paso de la grilla de horas ofrecidas
const BUFFER_MIN = 60                   // no se agenda dentro de la próxima hora (lead time del chofer)
// Cierre del HORARIO DE ATENCIÓN (09:00–22:00). Es el tope de las EUTANASIAS a
// domicilio, que las presta un vet de la red: ahí manda la hora que pidió el
// cliente, no la ventana del chofer (dueño 2026-07-28, ver evaluarHoraEutanasia).
const MIN_CIERRE_ATENCION = 22 * 60
// Anticipación mínima de una EUTANASIA a domicilio. Antes no tenía ninguna (solo
// se rechazaba una hora ya pasada), así que se podía agendar "en 10 minutos" —
// irreal para un servicio donde un vet de la red tiene que leer el correo,
// aceptar y viajar. Mismo criterio que el retiro del chofer: una hora.
const BUFFER_EUTANASIA_MIN = BUFFER_MIN
/**
 * COLCHÓN DE CONVERSACIÓN. Entre que el bot ofrece una hora y el cliente la
 * confirma pasan minutos, y con el mínimo justo (ahora + 1 h) la hora ofrecida
 * ya no servía al momento de registrarla: el bot confirmaba y se retractaba,
 * corriendo la hora de a un minuto (caso real 01-08-2026: 12:18 → 12:20 → 12:24
 * → 12:25 → 12:26, con el cliente respondiendo "sí" cada vez).
 *
 * Se ataca por los dos lados, con el mismo margen:
 *  1. toda hora que se OFRECE sale al menos 5 min más allá del mínimo, y
 *     redondeada hacia arriba a múltiplos de 5 (de paso las horas quedan
 *     redondas: 12:25 en vez de 12:18);
 *  2. al VALIDAR se acepta ese mismo margen de gracia, así la hora que acabamos
 *     de ofrecer sigue siendo válida mientras el cliente responde (~10 a 14
 *     minutos de ventana). El mínimo efectivo de anticipación pasa de 60 a 55
 *     minutos, solo en ese borde.
 */
const MARGEN_OFERTA_MIN = 5

/**
 * Primera hora OFRECIBLE de hoy (minutos desde medianoche): mínimo + colchón,
 * redondeada a múltiplos de 5. Exportada para que el prompt del bot calcule el
 * "próximo retiro posible" con el MISMO criterio que la agenda.
 */
export function proximoInicioOfrecible(ahora: number, buffer = BUFFER_MIN): number {
  return desdeOfrecible(ahora, buffer)
}

/** Primera hora OFRECIBLE de hoy: mínimo + colchón, redondeada a múltiplos de 5. */
function desdeOfrecible(ahora: number, buffer: number): number {
  const m = ahora + buffer + MARGEN_OFERTA_MIN
  return Math.ceil(m / MARGEN_OFERTA_MIN) * MARGEN_OFERTA_MIN
}

/** Mínimo EXIGIBLE: el buffer con el margen de gracia de la oferta. */
function minimoExigible(ahora: number, buffer: number): number {
  return ahora + buffer - MARGEN_OFERTA_MIN
}
// Eutanasia: el vet informa la hora del PROCEDIMIENTO (la que acordó con la
// familia) y nuestro chofer pasa a retirar 30 min después. Ese retiro se agenda
// al informarse la hora (dueño 2026-07-28) y queda guardado en la cotización
// (`hora_retiro_crematorio`), así que la agenda ya lo lee tal cual.
export const DESFASE_RETIRO_MIN = 30

/**
 * Hora del RETIRO del crematorio para una eutanasia: la del procedimiento + 30
 * min. Devuelve '' si la hora no es válida. Fuente única del desfase — la usan
 * el endpoint donde el vet informa la hora y cualquier vista que lo recalcule.
 */
export function horaRetiroDeEutanasia(horaServicio: string): string {
  const min = horaMin(horaServicio)
  if (min == null) return ''
  return fmtMin(Math.min(min + DESFASE_RETIRO_MIN, 24 * 60 - 1))
}

/**
 * ¿Esa hora queda fuera de la ventana de retiros del chofer (09:00–21:10)? Se usa
 * para avisarle al equipo cuando el retiro de una eutanasia tardía cae fuera y
 * hay que coordinarlo a mano (la eutanasia sí se puede agendar hasta las 22:00).
 */
export function fueraDeVentanaRetiro(horaHHMM: string): boolean {
  const min = horaMin(horaHHMM)
  if (min == null) return false
  return min < MIN_APERTURA || min > MIN_ULTIMO
}

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
  /**
   * Hora (HH:MM) en que NUESTRO chofer queda ocupado por este agendamiento — lo
   * único que bloquea la agenda. Es distinta de `hora`, que es lo que se MUESTRA:
   *  - retiro de cremación → la misma hora
   *  - eutanasia CON cremación → la hora del retiro; mientras el vet no la
   *    informe, la proyección (procedimiento + 30 min), que es cuando el chofer
   *    va a pasar de verdad
   *  - eutanasia SIN cremación → vacía: la hace un vet de la red, no ocupa nada
   * La eutanasia en sí NUNCA ocupa: puede superponerse con un retiro de
   * cremación (decisión del dueño 2026-08-05), porque son dos personas distintas.
   */
  horaOcupa?: string
  /** Eutanasia: true si aún no llega la hora de retiro del veterinario. */
  esperandoHoraVet?: boolean
  /** Eutanasia SIN cremación: solo recordatorio (etiqueta gris), NO bloquea la agenda. */
  sinCremacion?: boolean
  /**
   * La mascota YA está en nuestras manos (el retiro ocurrió) → en la agenda se
   * muestra como "listo" (azul) en vez de pendiente (verde). Usa la definición
   * única de lib/ficha-retiro: ficha registrada + la hora de retiro ya pasada.
   */
  retirada?: boolean
  /**
   * Quedó pisado con otro agendamiento del mismo día (misma regla que usa el bot
   * para no ofrecer esa hora). Pasa cuando el equipo agenda a mano encima de una
   * reserva: se permite a propósito, pero tiene que verse en la agenda.
   */
  superpuesto?: boolean
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
  const [retiros, cotis] = await Promise.all([
    getSheetData('solicitudes_retiro').catch(() => [] as Record<string, string>[]),
    getSheetData('cotizaciones_eutanasia').catch(() => [] as Record<string, string>[]),
  ])
  // Solo las fichas REFERENCIADAS por lo agendado: `clientes` es la tabla más
  // grande y se leía entera en cada evaluación de horario del bot.
  const idsFicha = [
    ...retiros.map(r => r.cliente_id),
    ...cotis.map(c => c.cliente_id),
  ].filter(Boolean) as string[]
  const clientes = await getRowsByIds('clientes', idsFicha).catch(() => [] as Record<string, string>[])
  const clientePorId = new Map(clientes.map(c => [String(c.id), c]))
  const inRange = (iso: string) => (!fromISO || iso >= fromISO) && (!toISO || iso <= toISO)
  const out: AgendaItem[] = []

  // La etiqueta azul ("listo") la dispara el REGISTRO de la ficha, no el reloj
  // (dueño 2026-08-19): registrarla es el acto con el que el equipo da por
  // recibida a la mascota —le genera el código de seguimiento y le manda el
  // correo al tutor—, así que para ellos ahí el retiro ya está hecho. Mirando la
  // hora agendada, un retiro adelantado (agendado 18:00, hecho 15:00) se quedaba
  // verde hasta las 18:00. Sin ficha vinculada no hay retiro posible.
  const yaRetirada = (ficha: Record<string, string> | undefined) => !!ficha && fichaIngresada(ficha)

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
      horaOcupa: min != null ? fmtMin(min) : '',
      bloque: bloqueDe(min),
      estado: estado === 'confirmada' ? 'confirmada' : 'pendiente',
      mascota: r.nombre_mascota || '',
      quien: esVet ? (r.vet_nombre || 'Veterinario') : (r.cliente_nombre || ''),
      esVet,
      comuna: r.comuna || '',
      direccion: r.direccion || '',
      tipo_servicio: r.tipo_servicio || '',
      clienteId: r.cliente_id || '',
      retirada: yaRetirada(ficha),
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
    // `hora_retiro_crematorio` YA es la hora del retiro (procedimiento + 30 min,
    // agendada cuando el vet informa la hora). Mientras no la informe, el bloque
    // se muestra en la hora de la eutanasia, en amarillo.
    const min = horaMin(tieneRetiro ? horaRetiro : c.hora_servicio)
    // Lo que ocupa al chofer es el RETIRO. Mientras el vet no informe la hora, se
    // PROYECTA (procedimiento + 30 min): antes se ocupaba la hora de la eutanasia,
    // media hora antes de que el chofer estuviera realmente comprometido.
    const minOcupa = tieneRetiro ? horaMin(horaRetiro) : horaMin(horaRetiroDeEutanasia(c.hora_servicio || ''))
    out.push({
      id: `e${c.id}`,
      tipo: 'eutanasia',
      fecha,
      hora: min != null ? fmtMin(min) : '',
      horaOcupa: minOcupa != null ? fmtMin(minOcupa) : '',
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
      retirada: yaRetirada(c.cliente_id ? clientePorId.get(String(c.cliente_id)) : undefined),
      ...valorEutanasia(c),
    })
  }

  return marcarSuperpuestos(out.sort((a, b) =>
    a.fecha.localeCompare(b.fecha) || (a.hora || '').localeCompare(b.hora || '')))
}

/**
 * Marca los agendamientos que quedaron pisados entre sí, con la MISMA regla que
 * usa el bot para no agendar ahí (`conflictosEnAgenda`: 30 min antes / 45
 * después, sobre la hora en que se ocupa el CHOFER).
 *
 * Existe porque el equipo puede agendar a mano encima de otra reserva —a veces
 * hay que hacerlo, y desde 2026-08-12 el sistema ya no lo impide— y esa
 * superposición tiene que verse en la agenda, no descubrirse el día del retiro.
 *
 * Se marcan LOS DOS lados. La regla no es simétrica (30 antes, 45 después), así
 * que un retiro puede chocar con otro sin que el otro choque con él; para una
 * etiqueta visual eso sería absurdo: si se pisan, se pisan los dos.
 */
function marcarSuperpuestos(items: AgendaItem[]): AgendaItem[] {
  const porDia = new Map<string, AgendaItem[]>()
  for (const it of items) {
    const arr = porDia.get(it.fecha)
    if (arr) arr.push(it); else porDia.set(it.fecha, [it])
  }
  const choca = (a: number, b: number) => a > b - SEP_ANTES && a < b + SEP_DESPUES
  for (const delDia of porDia.values()) {
    for (let i = 0; i < delDia.length; i++) {
      const ma = horaMin(delDia[i].horaOcupa)
      if (ma == null) continue
      for (let j = i + 1; j < delDia.length; j++) {
        const mb = horaMin(delDia[j].horaOcupa)
        if (mb == null) continue
        if (choca(ma, mb) || choca(mb, ma)) {
          delDia[i].superpuesto = true
          delDia[j].superpuesto = true
        }
      }
    }
  }
  return items
}

/**
 * Minutos de inicio de TODAS las reservas de una fecha (retiros + eutanasias,
 * con o sin hora de retiro informada), para el bloqueo del bot al minuto.
 *
 * `excluirId` saca de la cuenta una reserva puntual (id de AgendaItem, p. ej.
 * `r12`). Se usa al REPROGRAMAR: la reserva que se está moviendo no puede
 * bloquearse a sí misma — si no, mover un retiro de 21:00 a 20:45 "choca" con su
 * propio horario actual y el bot responde que no hay disponibilidad.
 */
async function ocupadosDe(fechaISO: string, excluirId?: string): Promise<number[]> {
  const items = await listarAgenda(fechaISO, fechaISO)
  const out: number[] = []
  for (const it of items) {
    if (excluirId && it.id === excluirId) continue
    // Manda `horaOcupa`: la hora en que el CHOFER queda comprometido. La eutanasia
    // sin cremación la deja vacía (no hay retiro) y la eutanasia con cremación la
    // pone en su retiro, no en el procedimiento.
    const min = horaMin(it.horaOcupa)
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
function horasLibres(
  fechaISO: string,
  hoy: string,
  ahora: number,
  ocupados: number[],
  rangos: RangoBloqueado[] = [],
  // `tope` = última hora ofrecible. Para RETIROS es el corte del chofer (21:10);
  // para EUTANASIAS, el cierre de atención (22:00) — sin esto, al cliente que
  // pedía "en la tarde" nunca se le ofrecía la última hora que sí aceptamos.
  opts: { tope?: number; buffer?: number } = {},
): string[] {
  if (fechaISO < hoy) return []
  const tope = opts.tope ?? MIN_ULTIMO
  const buffer = opts.buffer ?? BUFFER_MIN
  const esHoy = fechaISO === hoy
  const startMin = esHoy ? Math.max(MIN_APERTURA, desdeOfrecible(ahora, buffer)) : MIN_APERTURA
  const candidatos = new Set<number>([startMin, tope])
  // Grilla cada 45 min desde la apertura; se omiten los puntos a menos de 45 min
  // del cierre para no encimar 21:00 con el corte 21:10 (que siempre se ofrece).
  for (let m = MIN_APERTURA; m <= tope; m += SEPARACION_MIN) {
    if (m === tope || tope - m >= SEPARACION_MIN) candidatos.add(m)
  }
  for (const o of ocupados) { candidatos.add(o + SEP_DESPUES); candidatos.add(o - SEP_ANTES) }
  for (const r of rangos) candidatos.add(r.fin)   // el hueco apenas se libera el bloqueo
  return [...candidatos]
    .filter(min => min >= startMin && min <= tope && !choca(min, ocupados) && !bloqueadoEn(min, rangos))
    .sort((a, b) => a - b)
    .map(fmtMin)
}

export interface DisponibilidadDia {
  /** ISO YYYY-MM-DD */
  fecha: string
  /** Horas libres (HH:MM), de la más pronta a la más tarde. */
  libres: string[]
}

/** Fechas ISO consecutivas desde `desdeISO` (anclado a las 12:00 UTC: inmune al horario de verano). */
function fechasDesde(desdeISO: string, dias: number): string[] {
  const [Y, M, D] = desdeISO.split('-').map(Number)
  const pad = (n: number) => String(n).padStart(2, '0')
  return Array.from({ length: Math.max(1, dias) }, (_, i) => {
    const d = new Date(Date.UTC(Y, M - 1, D + i, 12, 0, 0))
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  })
}

/**
 * Horas realmente libres de los próximos `dias` días (empezando HOY en Chile),
 * con UNA sola lectura de la agenda para todo el rango.
 *
 * La consume el prompt del bot. Sin esto el modelo solo conocía la ventana
 * TEÓRICA (09:00–21:10) y no la ocupación real, así que terminaba presentando la
 * hora de CIERRE como si fuera "la última disponible" con el día entero libre
 * (caso Anita, 31-07-2026: a las 11:56, con solo dos retiros a las 09:45, le
 * ofreció las 21:10 como único horario y la clienta se fue).
 */
export async function disponibilidadProximosDias(dias = 2): Promise<DisponibilidadDia[]> {
  const { iso: hoy, min: ahora } = ahoraChile()
  const fechas = fechasDesde(hoy, dias)
  const desde = fechas[0], hasta = fechas[fechas.length - 1]
  const [items, bloqueos] = await Promise.all([
    listarAgenda(desde, hasta).catch(() => [] as AgendaItem[]),
    listarBloqueos(desde, hasta).catch(() => [] as BloqueoAgenda[]),
  ])
  const ocupados = new Map<string, number[]>()
  for (const it of items) {
    // Mismo criterio que ocupadosDe: solo ocupa la hora del chofer (`horaOcupa`).
    const min = horaMin(it.horaOcupa)
    if (min == null) continue
    ocupados.set(it.fecha, [...(ocupados.get(it.fecha) || []), min])
  }
  return fechas.map(fecha => ({
    fecha,
    libres: horasLibres(fecha, hoy, ahora, ocupados.get(fecha) || [], rangosDelDia(bloqueos, fecha)),
  }))
}

/**
 * Reservas de la agenda que CHOCAN con (fecha, hora) según la separación vigente
 * (30 min antes / 45 después). Devuelve los items para poder nombrarlos en el
 * aviso al equipo.
 *
 * Se usa donde una hora entra por un canal que NO puede rechazarse —la que el
 * veterinario informa tras coordinar con la familia, o un cambio a mano del
 * equipo—: ahí no se bloquea, se AVISA. Sin esto el choque era invisible (pasó
 * el 28-07: dos eutanasias quedaron a 30 min de retiros ya agendados).
 */
export async function conflictosEnAgenda(
  fechaRaw: string,
  horaRaw: string,
  excluirId?: string,
): Promise<AgendaItem[]> {
  const fecha = formatDateForSheet(fechaRaw) || String(fechaRaw || '').trim()
  const min = horaMin(horaRaw)
  if (!fecha || min == null) return []
  const items = await listarAgenda(fecha, fecha)
  return items.filter(it => {
    if (excluirId && it.id === excluirId) return false
    // Se compara contra `horaOcupa` (la hora del CHOFER), no contra la que se
    // muestra: si no, una eutanasia con cremación "chocaba" a la hora del
    // procedimiento, que es del veterinario y no compromete nuestra ruta.
    const m = horaMin(it.horaOcupa)
    return m != null && min > m - SEP_ANTES && min < m + SEP_DESPUES
  })
}

/** Texto corto de un choque, para los avisos al equipo. */
export function describirConflictos(items: AgendaItem[]): string {
  return items
    .map(it => `${it.tipo === 'eutanasia' ? 'eutanasia' : 'retiro'} de ${it.mascota || 'sin nombre'} a las ${it.hora}`)
    .join(' · ')
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
  // La eutanasia NO mira la agenda (ver evaluarHoraEutanasia): la presta un vet de
  // la red, así que se puede superponer con nuestros retiros y con los bloqueos.
  const libres = horasLibres(fecha, hoy, ahora, [], [],
    { tope: MIN_CIERRE_ATENCION, buffer: BUFFER_EUTANASIA_MIN })
  const libresFranja = libres.filter(h => {
    const hh = parseInt(h, 10)
    return franja === 'AM' ? hh < 13 : hh >= 13
  })
  const ref = (franja === 'AM' ? 10 : 16) * 60
  const orden = [...libresFranja].sort((a, b) => Math.abs((horaMin(a) ?? 0) - ref) - Math.abs((horaMin(b) ?? 0) - ref))
  return { hora: orden[0] || null, libresFranja }
}

/**
 * Valida la hora EXACTA que pidió el cliente para una EUTANASIA a domicilio.
 *
 * A diferencia del retiro (lo hace NUESTRO chofer, con su ventana y su hora de
 * anticipación), la eutanasia la presta un veterinario de la red que después
 * confirma disponibilidad. Por eso acá MANDA la hora que pidió el cliente
 * (decisión del dueño 2026-07-28, caso Gasparín: pidió las 21:00 y el sistema la
 * agendó a las 17:30): se respeta dentro del horario de atención 09:00–22:00 —el
 * mismo que el bot le promete— y solo se rechaza si de verdad no se puede:
 * fecha pasada u hora inválida. NO aplica el corte de las 21:10 ni el buffer de
 * la próxima hora.
 *
 * NO MIRA LA AGENDA (dueño 2026-08-05): la eutanasia SE PUEDE SUPERPONER con los
 * retiros de cremación y con los bloqueos manuales, porque la hace un veterinario
 * de la red y no compromete a nuestro chofer. Lo que sí compite por la agenda es
 * el RETIRO que viene después cuando el servicio incluye cremación — eso lo
 * resuelve `retiroTrasEutanasia`, que corre el retiro al primer hueco hábil.
 */
export async function evaluarHoraEutanasia(fechaRaw: string, horaRaw: string): Promise<EvalSlot> {
  const fecha = formatDateForSheet(fechaRaw) || String(fechaRaw || '').trim()
  const { iso: hoy, min: ahora } = ahoraChile()
  const libres = horasLibres(fecha, hoy, ahora, [], [],
    { tope: MIN_CIERRE_ATENCION, buffer: BUFFER_EUTANASIA_MIN })

  if (!fecha) return { ok: false, motivo: 'No indicaste una fecha válida.', libres }
  if (fecha < hoy) return { ok: false, motivo: `La fecha ${fecha} ya pasó.`, libres }

  const min = horaMin(horaRaw)
  if (min == null) return { ok: false, motivo: 'La hora no es válida (usa formato HH:MM).', libres }
  if (min < MIN_APERTURA || min > MIN_CIERRE_ATENCION)
    return { ok: false, motivo: `Atendemos de ${fmtMin(MIN_APERTURA)} a ${fmtMin(MIN_CIERRE_ATENCION)}: esa hora queda fuera del horario de atención.`, libres }
  // Anticipación mínima: el vet de la red tiene que aceptar y viajar.
  if (fecha === hoy && min < minimoExigible(ahora, BUFFER_EUTANASIA_MIN)) {
    const desde = Math.min(MIN_CIERRE_ATENCION, desdeOfrecible(ahora, BUFFER_EUTANASIA_MIN))
    return {
      ok: false,
      motivo: minimoExigible(ahora, BUFFER_EUTANASIA_MIN) > MIN_CIERRE_ATENCION
        ? 'Para hoy ya no alcanzamos a coordinar un veterinario (atendemos hasta las 22:00). Ofrécele mañana.'
        : `Necesitamos al menos una hora para coordinar al veterinario: para hoy, lo más pronto es a partir de las ${fmtMin(desde)}.`,
      libres,
    }
  }

  return { ok: true, libres }
}

/** Resultado de calcular el retiro que sigue a una eutanasia CON cremación. */
export interface RetiroTrasEutanasia {
  /** Hora final del retiro (HH:MM) — la que se agenda y se le dice al cliente. */
  hora: string
  /** Hora "natural": procedimiento + 30 min, antes de mirar la agenda. */
  base: string
  /** true si hubo que correrlo porque la hora natural estaba tomada. */
  desplazado: boolean
  /** Explicación corta y apta para el cliente (solo si `desplazado`). */
  motivo?: string
  /** No quedó ningún hueco hábil ese día: se deja la base y lo resuelve el equipo. */
  sinHueco?: boolean
}

/**
 * Hora del RETIRO que sigue a una eutanasia con cremación.
 *
 * Lo natural es procedimiento + 30 min, pero esa media hora es NUESTRA y compite
 * con el resto de la ruta del chofer. Si está topada por otro retiro (o por un
 * bloqueo manual), se corre al primer horario hábil LIBRE posterior en vez de
 * encimarse: antes se guardaba igual y el cruce solo se avisaba al equipo, que
 * quedaba con una ruta imposible (28-07: dos eutanasias a 30 min de retiros ya
 * agendados). Al cliente se le dice la hora final, no la teórica.
 *
 * Nunca se adelanta: el chofer no puede pasar antes de que el vet termine.
 *
 * `excluirAgendaId` saca de la cuenta la propia reserva (id de AgendaItem, p. ej.
 * `e12`) al reprogramarla: si no, se bloquearía a sí misma.
 */
export async function retiroTrasEutanasia(
  fechaRaw: string,
  horaServicio: string,
  opts: { excluirAgendaId?: string } = {},
): Promise<RetiroTrasEutanasia> {
  const fecha = formatDateForSheet(fechaRaw) || String(fechaRaw || '').trim()
  const base = horaRetiroDeEutanasia(horaServicio) || String(horaServicio || '').trim()
  if (!fecha || horaMin(base) == null) return { hora: base, base, desplazado: false }

  const [ocupados, bloqueos] = await Promise.all([
    ocupadosDe(fecha, opts.excluirAgendaId).catch(() => [] as number[]),
    listarBloqueos(fecha, fecha).catch(() => [] as BloqueoAgenda[]),
  ])
  return calcularRetiroTrasEutanasia(base, ocupados, rangosDelDia(bloqueos, fecha))
}

/**
 * Núcleo PURO de `retiroTrasEutanasia` (sin datastore ni reloj), para poder
 * verificarlo: `npx tsx scripts/verificar-retiro-eutanasia.ts`.
 *
 * `base` = hora natural del retiro (procedimiento + 30 min). Devuelve esa misma
 * hora si está libre, o el primer horario hábil LIBRE posterior. Nunca antes:
 * el chofer no puede pasar mientras el veterinario está trabajando.
 */
export function calcularRetiroTrasEutanasia(
  base: string,
  ocupados: number[],
  rangos: RangoBloqueado[] = [],
): RetiroTrasEutanasia {
  const baseMin = horaMin(base)
  if (baseMin == null) return { hora: base, base, desplazado: false }
  const libre = (m: number) => !choca(m, ocupados) && !bloqueadoEn(m, rangos)
  if (libre(baseMin)) return { hora: base, base, desplazado: false }

  // Candidatos POSTERIORES: la grilla habitual, el final de cada bloqueo y el
  // "justo después" de cada reserva (reserva + 45), que es el primer minuto en
  // que el chofer vuelve a estar libre. Se toma el más temprano que sirva.
  const candidatos = new Set<number>([MIN_ULTIMO])
  for (let m = MIN_APERTURA; m <= MIN_ULTIMO; m += SEPARACION_MIN) candidatos.add(m)
  for (const o of ocupados) candidatos.add(o + SEP_DESPUES)
  for (const r of rangos) candidatos.add(r.fin)

  const hueco = [...candidatos]
    .filter(m => m > baseMin && m <= MIN_ULTIMO && libre(m))
    .sort((a, b) => a - b)[0]

  if (hueco == null) return { hora: base, base, desplazado: false, sinHueco: true }
  return {
    hora: fmtMin(hueco),
    base,
    desplazado: true,
    motivo: `A las ${base} ya tenemos otro retiro en esa franja, así que el retiro queda a las ${fmtMin(hueco)}.`,
  }
}

/**
 * Valida si se puede agendar un retiro en (fecha, hora): ventana 09:00–21:10,
 * fuera de la próxima hora si es hoy, fuera de los bloqueos manuales de la agenda,
 * y respetando la separación con las demás reservas (30 min antes / 45 después).
 * Devuelve además las horas libres de ese día.
 *
 * `opts.excluirAgendaId` ignora una reserva existente al evaluar (y al listar las
 * horas libres): es la que se está REPROGRAMANDO, que no debe bloquearse a sí
 * misma. Formato de id de AgendaItem — para un retiro, `r${solicitud.id}`.
 */
export async function evaluarSlotRetiro(
  fechaRaw: string,
  horaRaw: string,
  opts: { excluirAgendaId?: string } = {},
): Promise<EvalSlot> {
  const fecha = formatDateForSheet(fechaRaw) || String(fechaRaw || '').trim()
  const { iso: hoy, min: ahora } = ahoraChile()
  const [ocupados, bloqueos] = await Promise.all([ocupadosDe(fecha, opts.excluirAgendaId), listarBloqueos(fecha, fecha)])
  const rangos = rangosDelDia(bloqueos, fecha)
  const libres = horasLibres(fecha, hoy, ahora, ocupados, rangos)

  if (!fecha) return { ok: false, motivo: 'No indicaste una fecha válida.', libres }
  if (fecha < hoy) return { ok: false, motivo: `La fecha ${fecha} ya pasó.`, libres }

  const min = horaMin(horaRaw)
  if (min == null) return { ok: false, motivo: 'La hora no es válida (usa formato HH:MM).', libres }
  if (min < MIN_APERTURA || min > MIN_ULTIMO)
    return { ok: false, motivo: 'Los retiros se agendan entre las 09:00 y las 21:10 (la última hora para agendar es 21:10).', libres }

  if (fecha === hoy && min < minimoExigible(ahora, BUFFER_MIN)) {
    // La hora que se sugiere es la OFRECIBLE (con colchón): si el cliente tarda
    // un par de minutos en confirmarla, sigue siendo válida.
    const desde = Math.min(MIN_ULTIMO, desdeOfrecible(ahora, BUFFER_MIN))
    const msg = minimoExigible(ahora, BUFFER_MIN) > MIN_ULTIMO
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

// ── PRÓXIMO RETIRO POSIBLE (fuente ÚNICA) ────────────────────────────────────
/**
 * Primera fecha/hora en que realmente podemos pasar a retirar.
 *
 * ⚠️ Existe para que NO haya dos cálculos. Antes vivía embebido en el prompt del
 * bot (lib/agente-mensajes) mientras `cotizar_cremacion` decidía el recargo con
 * la fecha/hora que le pasaran —vacía en la primera cotización—. Resultado: en
 * fin de semana el prompt decía "hay recargo, súmalo siempre" y la herramienta
 * respondía "no aplica recargo: NO lo menciones". El modelo quedaba atrapado
 * entre las dos y DELIBERABA EN VOZ ALTA delante del cliente ("Espera, la
 * herramienta dice que no aplica recargo, pero hoy es sábado…"): 11 mensajes así
 * en 30 conversaciones, todos en fin de semana o después de las 18:00.
 *
 * Regla: mínimo = ahora + 1 h, acotado a la ventana 09:00–21:10.
 *  - antes de las 09:00 → HOY a las 09:00 (que sea de madrugada no significa que
 *    "hoy" ya pasó: la ventana del día está entera por delante);
 *  - dentro de la ventana → HOY a esa hora;
 *  - pasadas las 21:10 → MAÑANA a las 09:00.
 * Después corre por los bloqueos manuales y, si se conoce la disponibilidad real,
 * se queda con la primera hora efectivamente libre.
 */
export interface ProximoRetiro {
  /** Fecha ISO (YYYY-MM-DD) en Chile. */
  iso: string
  /** Hora HH:MM. */
  hora: string
  /** Minutos desde medianoche. */
  min: number
  /** Días desde hoy (0 = hoy). */
  offset: number
}

export function calcularProximoRetiro(
  hoyISO: string,
  ahoraMin: number,
  bloqueos: BloqueoAgenda[] = [],
  dispo: DisponibilidadDia[] = [],
): ProximoRetiro {
  const [Y, M, D] = hoyISO.split('-').map(Number)
  const pad = (n: number) => String(n).padStart(2, '0')
  const isoDe = (off: number) => {
    const d = new Date(Date.UTC(Y, M - 1, D + off, 12, 0, 0))
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  }
  const OPEN = HORA_APERTURA * 60
  const CLOSE = HORA_ULTIMO_RETIRO * 60 + 10

  let offset = 0
  let min = proximoInicioOfrecible(ahoraMin)
  if (min < OPEN) min = OPEN
  else if (min > CLOSE) { offset = 1; min = OPEN }

  // Bloqueos manuales cargados por el equipo: corre hasta el fin del bloqueo.
  for (let i = 0; i < 40; i++) {
    const tapa = rangosDelDia(bloqueos, isoDe(offset)).find(r => min >= r.ini && min < r.fin)
    if (!tapa) break
    min = tapa.fin
    if (min > CLOSE) { offset += 1; min = OPEN }
  }

  // Si conocemos la agenda REAL, manda la primera hora libre de verdad.
  const primerDiaLibre = dispo.findIndex(d => d.libres.length > 0)
  if (primerDiaLibre >= 0) {
    const h = horaMin(dispo[primerDiaLibre].libres[0])
    if (h != null) { offset = primerDiaLibre; min = h }
  }

  return { iso: isoDe(offset), hora: fmtMin(min), min, offset }
}

/**
 * Igual que `calcularProximoRetiro` pero cargando por su cuenta la hora de Chile,
 * los bloqueos y la disponibilidad. Para quien no los tenga ya en mano (p. ej. la
 * herramienta de cotización). Best-effort: si la agenda no responde, cae a la
 * ventana teórica en vez de fallar.
 */
export async function proximoRetiroPosible(): Promise<ProximoRetiro> {
  const { iso, min } = ahoraChile()
  let bloqueos: BloqueoAgenda[] = []
  let dispo: DisponibilidadDia[] = []
  try { bloqueos = await listarBloqueos() } catch { /* sin bloqueos */ }
  try { dispo = await disponibilidadProximosDias(2) } catch { /* sin agenda */ }
  return calcularProximoRetiro(iso, min, bloqueos, dispo)
}
