/** Tipos que comparte la UI de Remuneraciones con sus endpoints. */
import type {
  Empleado, Liquidacion, Novedades, Parametros, ResultadoSolver,
} from '@/lib/remuneraciones/tipos'

export type { Empleado, Liquidacion, Novedades, Parametros, ResultadoSolver }

export interface ResultadoUI {
  empleado_id: string
  empleado_nombre: string
  cargo: string
  afp: string
  prevision_salud: string
  novedades: Novedades
  liquidacion: Liquidacion
  solver: ResultadoSolver | null
}

export interface CalendarioUI {
  dias_habiles: number
  dias_descanso: number
  manual: boolean
  detalle: { total: number; habiles: number; feriados: number; domingos: number; sabados: number; descanso: number }
}

export interface TotalesUI {
  liquidos: number
  reembolsos: number
  transferido: number
  haberes: number
  aportes: number
  costo_empresa: number
}

export interface PeriodoUI {
  periodo: string
  estado: 'borrador' | 'cerrada' | 'pagada'
  parametros: Parametros | null
  faltantes: string[]
  calendario: CalendarioUI
  cremaciones: number
  empleados: Empleado[]
  guardadas: {
    id: string
    empleado_id: string
    empleado_nombre: string
    estado: string
    liquido: number
    total_a_transferir: number
    costo_empresa: number
    pdf_url: string
  }[]
  pago: { fecha_pago: string; total_transferido: number } | null
  resultados: ResultadoUI[]
  totales: TotalesUI
}

/** Período actual en formato YYYY-MM, en hora de Chile. */
export function periodoActual(): string {
  const ahora = new Date()
  const chile = new Date(ahora.toLocaleString('en-US', { timeZone: 'America/Santiago' }))
  return `${chile.getFullYear()}-${String(chile.getMonth() + 1).padStart(2, '0')}`
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

/** '2026-07' → 'julio 2026'. */
export function nombrePeriodo(periodo: string): string {
  const [a, m] = periodo.split('-').map(Number)
  if (!a || !m) return periodo
  return `${MESES[m - 1]} ${a}`
}

/** Corre un período N meses (positivo o negativo). */
export function moverPeriodo(periodo: string, meses: number): string {
  const [a, m] = periodo.split('-').map(Number)
  const d = new Date(a, m - 1 + meses, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
