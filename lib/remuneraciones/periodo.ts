/**
 * Orquestación de un período (mes): junta el calendario, las cremaciones
 * efectivas y las novedades de cada empleado, y corre el motor + solver.
 *
 * Lo que la UI llama "Base del mes" sale de acá.
 */
import { diasDelMes } from '@/lib/dias-habiles'
import { cremacionesDelPeriodo, type FichaCremada } from '@/lib/cremaciones-mes'
import { listarEmpleados, listarLiquidaciones, type LiquidacionGuardada } from './datos'
import { faltantes, getFilaParametros, overridesCalendario, parsearParametros } from './parametros'
import { liquidar } from './solver'
import type { Empleado, Liquidacion, Novedades, Parametros, ResultadoSolver } from './tipos'

/** 'YYYY-MM' válido. */
export function esPeriodoValido(periodo: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

/** '2026-07' → 'julio de 2026'. */
export function nombreDePeriodo(periodo: string): string {
  const [a, m] = periodo.split('-').map(Number)
  if (!a || !m) return periodo
  return `${MESES[m - 1]} de ${a}`
}

/** Último día del período, en ISO. Es la fecha con que se imputa al EERR. */
export function ultimoDiaDelPeriodo(periodo: string): string {
  const [anio, mes] = periodo.split('-').map(Number)
  const dia = new Date(anio, mes, 0).getDate()
  return `${periodo}-${String(dia).padStart(2, '0')}`
}

export interface CalendarioPeriodo {
  dias_habiles: number
  dias_descanso: number
  /** True si los valores vienen de un override manual y no del almanaque. */
  manual: boolean
  detalle: ReturnType<typeof diasDelMes>
}

export function calendarioDelPeriodo(periodo: string, override?: { dias_habiles: number | null; dias_descanso: number | null }): CalendarioPeriodo {
  const [anio, mes] = periodo.split('-').map(Number)
  const detalle = diasDelMes(anio, mes)
  const manual = !!(override?.dias_habiles || override?.dias_descanso)
  return {
    dias_habiles: override?.dias_habiles || detalle.habiles,
    dias_descanso: override?.dias_descanso || detalle.descanso,
    manual,
    detalle,
  }
}

/** Novedades vacías, con el calendario y las cremaciones del mes ya puestas. */
export function novedadesPorDefecto(cremaciones: number, cal: CalendarioPeriodo): Novedades {
  return {
    cremaciones,
    dias_trabajados: 30,
    dias_efectivos: cal.dias_habiles,
    dias_descanso: cal.dias_descanso,
    horas_extra: 0,
    otros_imponibles: [],
    otros_no_imponibles: [],
    otros_descuentos: [],
    anticipos: 0,
  }
}

/** Mezcla lo guardado / lo que manda la UI sobre las novedades por defecto. */
export function mezclarNovedades(base: Novedades, parcial?: Partial<Novedades> | null): Novedades {
  if (!parcial) return base
  return {
    cremaciones: parcial.cremaciones ?? base.cremaciones,
    dias_trabajados: parcial.dias_trabajados ?? base.dias_trabajados,
    dias_efectivos: parcial.dias_efectivos ?? base.dias_efectivos,
    dias_descanso: parcial.dias_descanso ?? base.dias_descanso,
    horas_extra: parcial.horas_extra ?? base.horas_extra,
    otros_imponibles: parcial.otros_imponibles ?? base.otros_imponibles,
    otros_no_imponibles: parcial.otros_no_imponibles ?? base.otros_no_imponibles,
    otros_descuentos: parcial.otros_descuentos ?? base.otros_descuentos,
    anticipos: parcial.anticipos ?? base.anticipos,
  }
}

export interface ResultadoEmpleado {
  empleado: Empleado
  novedades: Novedades
  liquidacion: Liquidacion
  solver: ResultadoSolver | null
}

export interface ContextoPeriodo {
  periodo: string
  parametros: Parametros | null
  /** Qué falta para poder calcular (UF/UTM sin cargar, etc.). */
  faltantes: string[]
  calendario: CalendarioPeriodo
  cremaciones: number
  fichas: FichaCremada[]
  empleados: Empleado[]
  guardadas: LiquidacionGuardada[]
}

/** Todo lo que necesita la pantalla del período, en una sola lectura. */
export async function contextoPeriodo(periodo: string): Promise<ContextoPeriodo> {
  const [filaParams, fichas, empleados, guardadas] = await Promise.all([
    getFilaParametros(periodo),
    cremacionesDelPeriodo(periodo),
    listarEmpleados(false),
    listarLiquidaciones(periodo),
  ])
  const parametros = filaParams ? parsearParametros(filaParams) : null
  const calendario = calendarioDelPeriodo(periodo, filaParams ? overridesCalendario(filaParams) : undefined)
  return {
    periodo,
    parametros,
    faltantes: faltantes(parametros),
    calendario,
    cremaciones: fichas.length,
    fichas,
    empleados,
    guardadas,
  }
}

/**
 * Corre el cálculo de todos los empleados activos del período. Reusa las
 * novedades ya guardadas (para no perder horas extra ni anticipos cargados) y
 * les aplica los overrides que venga mandando la UI.
 */
export function calcularPeriodo(
  ctx: ContextoPeriodo,
  overrides: Record<string, Partial<Novedades>> = {},
  cremacionesOverride?: number,
): ResultadoEmpleado[] {
  if (!ctx.parametros) return []
  const cremaciones = cremacionesOverride ?? ctx.cremaciones
  const base = novedadesPorDefecto(cremaciones, ctx.calendario)
  const guardadaPorEmpleado = new Map(ctx.guardadas.map(g => [g.empleado_id, g]))

  return ctx.empleados.map(empleado => {
    const previa = guardadaPorEmpleado.get(empleado.id)?.novedades ?? null
    // Las cremaciones y el calendario mandan del período, no de lo guardado.
    const conPrevias = mezclarNovedades(base, previa ? { ...previa, cremaciones, dias_efectivos: base.dias_efectivos, dias_descanso: base.dias_descanso } : null)
    const novedades = mezclarNovedades(conPrevias, overrides[empleado.id])
    const { liquidacion, solver } = liquidar({ empleado, novedades, parametros: ctx.parametros! })
    return { empleado, novedades, liquidacion, solver }
  })
}

/** Totales del período: lo que se transfiere y lo que cuesta a la empresa. */
export function totalesPeriodo(resultados: { liquidacion: Liquidacion }[]) {
  const acc = { liquidos: 0, reembolsos: 0, transferido: 0, haberes: 0, aportes: 0, costo_empresa: 0 }
  for (const { liquidacion: l } of resultados) {
    acc.liquidos += l.totales.liquido
    acc.reembolsos += l.totales.reembolso_salud
    acc.transferido += l.totales.total_a_transferir
    acc.haberes += l.totales.total_haberes
    acc.aportes += l.totales.aportes_empleador
    acc.costo_empresa += l.totales.costo_empresa
  }
  return acc
}
