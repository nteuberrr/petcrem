/**
 * Cuándo se cremó una mascota, y cuántas se cremaron en un mes.
 *
 * Definición canónica del sistema (la misma que usan el dashboard y los
 * reportes): una ficha cuenta como cremada si su `estado` es `cremado` o
 * `despachado` — ambas pasaron por el horno — y la fecha que manda es la del
 * CICLO asociado (`ciclos.fecha` vía `clientes.ciclo_id`). Solo si no hay ciclo
 * válido se cae a `fecha_retiro` y, en último término, a `fecha_creacion`.
 *
 * Vivía duplicada en app/api/dashboard/route.ts y app/api/reportes/route.ts;
 * está acá para que Remuneraciones (donde el número define cuánto cobra cada
 * operario) use exactamente el mismo criterio y no una cuarta variante.
 */
import { getSheetData } from './datastore'
import { formatDateForSheet } from './dates'

type Fila = Record<string, string>

/** Parsea una fecha de la base (serial Excel, ISO o DD/MM/YYYY) al mediodía local. */
export function parseFechaSegura(raw: string | undefined | null): Date | null {
  if (!raw) return null
  const iso = formatDateForSheet(raw)
  if (!iso) return null
  const d = new Date(`${iso}T12:00:00`) // mediodía local: evita el corrimiento UTC
  return isNaN(d.getTime()) ? null : d
}

/** True si la ficha ya pasó por el horno (cremada o ya entregada). */
export function estaCremada(c: Fila): boolean {
  return c.estado === 'cremado' || c.estado === 'despachado'
}

/**
 * Devuelve un resolver `fechaCremacion(ficha)` con cache por ficha. Se le pasan
 * los ciclos ya leídos para no volver a consultarlos por cada llamada.
 */
export function crearResolverCremacion(ciclos: Fila[]) {
  const cicloById = new Map(ciclos.map(c => [c.id, c]))
  const cache = new Map<string, Date | null>()
  return function fechaCremacion(c: Fila): Date | null {
    const hit = cache.get(c.id)
    if (hit !== undefined) return hit
    let d: Date | null = null
    if (c.ciclo_id) {
      const ciclo = cicloById.get(c.ciclo_id)
      if (ciclo?.fecha) d = parseFechaSegura(ciclo.fecha)
    }
    if (!d) d = parseFechaSegura(c.fecha_retiro || c.fecha_creacion)
    cache.set(c.id, d)
    return d
  }
}

export interface FichaCremada {
  id: string
  codigo: string
  nombre_mascota: string
  /** ISO YYYY-MM-DD de la cremación. */
  fecha: string
  ciclo_id: string
}

/**
 * Fichas efectivamente cremadas en un período ('YYYY-MM'), ordenadas por fecha.
 * El listado es el respaldo auditable del número que se usa para pagar: la UI
 * lo muestra detrás del "ver las 73".
 */
export async function cremacionesDelPeriodo(periodo: string): Promise<FichaCremada[]> {
  const [anioStr, mesStr] = periodo.split('-')
  const anio = parseInt(anioStr, 10)
  const mes = parseInt(mesStr, 10)
  if (!anio || !mes) return []

  const [clientes, ciclos] = await Promise.all([
    getSheetData('clientes').catch(() => [] as Fila[]),
    getSheetData('ciclos').catch(() => [] as Fila[]),
  ])
  const fechaCremacion = crearResolverCremacion(ciclos)

  const out: FichaCremada[] = []
  for (const c of clientes) {
    if (!estaCremada(c)) continue
    const d = fechaCremacion(c)
    if (!d || d.getFullYear() !== anio || d.getMonth() + 1 !== mes) continue
    out.push({
      id: String(c.id || ''),
      codigo: String(c.codigo || ''),
      nombre_mascota: String(c.nombre_mascota || ''),
      fecha: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      ciclo_id: String(c.ciclo_id || ''),
    })
  }
  out.sort((a, b) => a.fecha.localeCompare(b.fecha))
  return out
}
