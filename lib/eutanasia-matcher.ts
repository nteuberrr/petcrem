import { buscarComuna } from './comunas'
import { formatHoraDia, parseFecha } from './dates'

/**
 * Reglas de matching para encontrar vets del convenio que pueden atender
 * una cotización.
 *
 * Inputs:
 * - Cotización: comuna, fecha_servicio (YYYY-MM-DD), hora_servicio (HH:MM 24h).
 * - Vet: comunas (JSON array), horarios (JSON object días → {am, pm}), activo.
 *
 * Reglas:
 * 1. El vet debe estar activo (activo === 'TRUE').
 * 2. La comuna debe estar en sus comunas atendidas (normalizada via canónica).
 * 3. La fecha cae en un día de la semana → el vet debe tener al menos el slot
 *    AM o PM activo según la hora. Corte a las 13:00:
 *      - AM = 00:00 a 12:59
 *      - PM = 13:01 a 23:59
 *      - 13:00 EXACTO pertenece a ambos turnos (sirve un vet AM o PM).
 */

export type DiaKey = 'lun' | 'mar' | 'mie' | 'jue' | 'vie' | 'sab' | 'dom'
export type Slot = 'am' | 'pm'

/** Mapeo Date.getDay() (0=domingo, 6=sábado) → key. */
const DIA_KEYS: DiaKey[] = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab']

export interface VetMatch {
  id: string
  nombre: string
  apellido: string
  email: string
  telefono: string
  comunas: string[]
  horarios: Record<string, { am?: boolean; pm?: boolean }>
}

/**
 * Calcula día de la semana y slot AM/PM para una fecha+hora.
 * - Acepta fechaISO como "YYYY-MM-DD", "DD/MM/YYYY", "DD-MM-YYYY", o como
 *   Excel serial number (lo que devuelve Sheets con UNFORMATTED_VALUE).
 * - Acepta horaHHMM como "HH:MM", como fracción decimal de día ("0.5" → 12:00)
 *   o como dígitos sin punto ("5" → 12:00).
 */
export function diaYSlotPara(fechaISO: string, horaHHMM: string): { dia: DiaKey; slots: Slot[] } | null {
  if (!fechaISO || !horaHHMM) return null

  // Normalizar la hora a "HH:MM"
  const horaNorm = formatHoraDia(horaHHMM)
  if (horaNorm === '—' || !/^\d{2}:\d{2}$/.test(horaNorm)) return null
  const [hh, mm] = horaNorm.split(':').map(n => parseInt(n, 10))
  if (isNaN(hh)) return null

  // Normalizar la fecha. parseFecha entiende serials de Sheets y formatos DMY.
  const baseDate = parseFecha(fechaISO)
  if (!baseDate) return null

  // Construimos un Date local con la hora ya parseada. Usamos getFullYear/etc
  // del baseDate (que ya está en local) y aplicamos la hora encima.
  const dt = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), hh, mm || 0, 0, 0)
  const dia = DIA_KEYS[dt.getDay()]
  // Corte AM/PM a las 13:00. Las 13:00 en punto cuentan para ambos turnos.
  let slots: Slot[]
  if (hh < 13) slots = ['am']
  else if (hh === 13 && (mm || 0) === 0) slots = ['am', 'pm']
  else slots = ['pm']
  return { dia, slots }
}

export type RazonExclusion =
  | 'inactivo'
  | 'no_cubre_comuna'
  | 'sin_horario_en_dia'
  | 'sin_slot_am'
  | 'sin_slot_pm'

export interface VetExcluido {
  id: string
  nombre_completo: string
  email: string
  razon: RazonExclusion
  detalle: string
}

export interface MatchResultado {
  matched: VetMatch[]
  excluidos: VetExcluido[]
  comuna_canonica: string
  /** Si fue null, no pudimos parsear la fecha/hora — caso degenerado. */
  horario_ref: { dia: DiaKey; slots: Slot[] } | null
}

/**
 * Versión con diagnóstico de matchVets: además del listado de vets que pasan,
 * devuelve por cada vet excluido la razón concreta. Útil para mostrar al admin
 * cuando no hay coincidencias y entender qué ajustar (comuna ingresada,
 * horario del vet, fecha de la cotización, etc.).
 */
export function matchVetsConDiagnostico(
  vets: Record<string, string>[],
  comuna: string,
  fechaISO: string,
  horaHHMM: string,
): MatchResultado {
  const comunaCanon = buscarComuna(comuna)?.nombre ?? comuna
  const horarioRef = diaYSlotPara(fechaISO, horaHHMM)

  const matched: VetMatch[] = []
  const excluidos: VetExcluido[] = []

  for (const v of vets) {
    const nombre_completo = `${v.nombre ?? ''} ${v.apellido ?? ''}`.trim() || v.email || '(sin nombre)'
    const baseExc = { id: v.id, nombre_completo, email: v.email ?? '' }

    if ((v.activo ?? 'TRUE').toUpperCase() !== 'TRUE') {
      excluidos.push({ ...baseExc, razon: 'inactivo', detalle: 'El vet está marcado como inactivo.' })
      continue
    }

    let comunas: string[] = []
    try { const x = JSON.parse(v.comunas ?? '[]'); if (Array.isArray(x)) comunas = x } catch { /* */ }
    if (!comunas.includes(comunaCanon)) {
      excluidos.push({
        ...baseExc,
        razon: 'no_cubre_comuna',
        detalle: `No cubre "${comunaCanon}". Cubre: ${comunas.length > 0 ? comunas.join(', ') : '(ninguna)'}.`,
      })
      continue
    }

    let horarios: Record<string, { am?: boolean; pm?: boolean }> = {}
    try { const x = JSON.parse(v.horarios ?? '{}'); if (x && typeof x === 'object') horarios = x } catch { /* */ }

    if (!horarioRef) {
      // Si no pudimos parsear fecha/hora, no descartamos; lo registramos arriba.
      continue
    }

    const diaH = horarios[horarioRef.dia]
    if (!diaH) {
      excluidos.push({
        ...baseExc,
        razon: 'sin_horario_en_dia',
        detalle: `No atiende los ${nombreDia(horarioRef.dia)}.`,
      })
      continue
    }
    // El vet sirve si tiene activo AL MENOS UNO de los turnos requeridos.
    // Para una hora normal hay un solo turno requerido; a las 13:00 en punto
    // se requieren ambos (am|pm), por lo que cualquier vet con turno ese día sirve.
    const slots = horarioRef.slots
    if (!slots.some(s => diaH[s])) {
      if (slots.length === 1 && slots[0] === 'am') {
        excluidos.push({ ...baseExc, razon: 'sin_slot_am', detalle: `Atiende los ${nombreDia(horarioRef.dia)} solo en PM (la cotización es AM).` })
      } else if (slots.length === 1 && slots[0] === 'pm') {
        excluidos.push({ ...baseExc, razon: 'sin_slot_pm', detalle: `Atiende los ${nombreDia(horarioRef.dia)} solo en AM (la cotización es PM).` })
      } else {
        excluidos.push({ ...baseExc, razon: 'sin_horario_en_dia', detalle: `No tiene turnos activos los ${nombreDia(horarioRef.dia)}.` })
      }
      continue
    }

    matched.push({
      id: v.id,
      nombre: v.nombre ?? '',
      apellido: v.apellido ?? '',
      email: v.email,
      telefono: v.telefono ?? '',
      comunas,
      horarios,
    })
  }

  return { matched, excluidos, comuna_canonica: comunaCanon, horario_ref: horarioRef }
}

function nombreDia(k: DiaKey): string {
  return { lun: 'lunes', mar: 'martes', mie: 'miércoles', jue: 'jueves', vie: 'viernes', sab: 'sábado', dom: 'domingo' }[k]
}

/**
 * Wrapper sin diagnóstico para callers que solo quieren la lista.
 */
export function matchVets(
  vets: Record<string, string>[],
  comuna: string,
  fechaISO: string,
  horaHHMM: string,
): VetMatch[] {
  return matchVetsConDiagnostico(vets, comuna, fechaISO, horaHHMM).matched
}

/** Busca el precio que corresponde a un peso (kg) en tramos. */
export function precioParaPeso(
  tramos: Array<Record<string, string>>,
  peso: number,
): number {
  if (!Number.isFinite(peso) || peso < 0) return 0
  for (const t of tramos) {
    const min = parseFloat(t.peso_min)
    const max = parseFloat(t.peso_max)
    if (peso >= min && peso < max) return parseInt(t.precio, 10) || 0
  }
  // Si peso es exactamente igual al peso_max del último tramo, devuelvo ese precio
  const ultimo = [...tramos].sort((a, b) => parseFloat(b.peso_max) - parseFloat(a.peso_max))[0]
  if (ultimo && peso <= parseFloat(ultimo.peso_max)) return parseInt(ultimo.precio, 10) || 0
  return 0
}
