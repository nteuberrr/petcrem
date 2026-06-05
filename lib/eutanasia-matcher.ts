import { buscarComuna } from './comunas'
import { formatHoraDia } from './dates'

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
 *    AM o PM activo según la hora. AM = 00:00-11:59, PM = 12:00-23:59.
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
 * Acepta horaHHMM como "HH:MM", como fracción decimal de día ("0.5" → 12:00)
 * o como dígitos sin punto ("5" → 12:00, formato que devuelve Sheets cuando
 * la celda tiene formato de tiempo). Usa formatHoraDia() para normalizar.
 */
export function diaYSlotPara(fechaISO: string, horaHHMM: string): { dia: DiaKey; slot: Slot } | null {
  if (!fechaISO || !horaHHMM) return null
  // Normalizar la hora a "HH:MM"
  const horaNorm = formatHoraDia(horaHHMM)
  if (horaNorm === '—' || !/^\d{2}:\d{2}$/.test(horaNorm)) return null

  // Construimos la fecha como "local" para que el día de la semana sea el chileno
  // intuitivo, no el UTC. Si el usuario pone 2026-06-08 21:00, queremos lunes PM,
  // no martes AM (que es lo que daría toISOString sobre Chile UTC-4).
  const [y, m, d] = fechaISO.split('-').map(n => parseInt(n, 10))
  const [hh, mm] = horaNorm.split(':').map(n => parseInt(n, 10))
  if ([y, m, d, hh].some(n => isNaN(n))) return null
  const dt = new Date(y, (m || 1) - 1, d || 1, hh, mm || 0, 0, 0)
  const dia = DIA_KEYS[dt.getDay()]
  const slot: Slot = hh < 12 ? 'am' : 'pm'
  return { dia, slot }
}

/**
 * Filtra vets que cumplen los tres criterios.
 * Acepta cualquier Record<string,string> (formato getSheetData) y usa los campos
 * que necesita; los campos opcionales se interpretan como vacío.
 */
export function matchVets(
  vets: Record<string, string>[],
  comuna: string,
  fechaISO: string,
  horaHHMM: string,
): VetMatch[] {
  const comunaCanon = buscarComuna(comuna)?.nombre ?? comuna
  const horarioRef = diaYSlotPara(fechaISO, horaHHMM)
  if (!horarioRef) return []

  const out: VetMatch[] = []
  for (const v of vets) {
    if ((v.activo ?? 'TRUE').toUpperCase() !== 'TRUE') continue
    let comunas: string[] = []
    try { const x = JSON.parse(v.comunas ?? '[]'); if (Array.isArray(x)) comunas = x } catch { /* */ }
    if (!comunas.includes(comunaCanon)) continue

    let horarios: Record<string, { am?: boolean; pm?: boolean }> = {}
    try { const x = JSON.parse(v.horarios ?? '{}'); if (x && typeof x === 'object') horarios = x } catch { /* */ }
    const diaH = horarios[horarioRef.dia]
    if (!diaH) continue
    if (horarioRef.slot === 'am' && !diaH.am) continue
    if (horarioRef.slot === 'pm' && !diaH.pm) continue

    out.push({
      id: v.id,
      nombre: v.nombre ?? '',
      apellido: v.apellido ?? '',
      email: v.email,
      telefono: v.telefono ?? '',
      comunas,
      horarios,
    })
  }
  return out
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
