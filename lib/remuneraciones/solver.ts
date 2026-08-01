/**
 * El solver que reemplaza al Solver de Excel.
 *
 * El acuerdo con los operarios es que reciban LÍQUIDO el sueldo base más un
 * monto fijo por cremación efectivamente realizada en el mes. Como ese monto
 * viaja por la liquidación (paga AFP, salud, gratificación, semana corrida), el
 * bono imponible que hay que poner arriba no es el mismo que llega abajo: en el
 * Excel se buscaba a mano moviendo una celda hasta que cuadrara.
 *
 * Acá se resuelve con búsqueda binaria. El líquido crece de forma monótona con
 * el bono, así que se busca el MENOR bono entero cuyo líquido alcanza la meta.
 * Por los redondeos de cada descuento puede no existir un bono que dé el valor
 * exacto; en ese caso se devuelve `exacto: false` con la diferencia, y la UI la
 * muestra en vez de fingir que cuadró.
 */

import { calcularLiquidacion } from './motor'
import type { EmpleadoCalculo, Novedades, Parametros, ResultadoSolver } from './tipos'

export interface ContextoSolver {
  empleado: EmpleadoCalculo
  novedades: Novedades
  parametros: Parametros
}

function liquidoDe(ctx: ContextoSolver, variableImponible: number): number {
  return calcularLiquidacion({ ...ctx, variableImponible }).totales.liquido
}

/** Meta de líquido pactada: sueldo base + valor por cremación × cremaciones. */
export function metaLiquido(empleado: EmpleadoCalculo, novedades: Novedades): number {
  const base = novedades.sueldo_base && novedades.sueldo_base > 0 ? novedades.sueldo_base : empleado.sueldo_base
  return Math.round(base + empleado.valor_por_cremacion * novedades.cremaciones)
}

/**
 * Busca el bono variable imponible que hace que el líquido alcance `meta`.
 * Devuelve el menor bono entero cuyo líquido es ≥ meta.
 */
export function resolverVariable(ctx: ContextoSolver, meta: number): ResultadoSolver {
  const base = liquidoDe(ctx, 0)
  if (base >= meta) {
    return { variable_imponible: 0, liquido: base, meta, exacto: base === meta, diferencia: base - meta }
  }

  // Cota superior: se duplica hasta pasar la meta (evita magias tipo meta × 3).
  let hi = 1000
  while (liquidoDe(ctx, hi) < meta && hi < 1e9) hi *= 2

  let lo = 0
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (liquidoDe(ctx, mid) >= meta) hi = mid
    else lo = mid + 1
  }

  const liquido = liquidoDe(ctx, lo)
  return { variable_imponible: lo, liquido, meta, exacto: liquido === meta, diferencia: liquido - meta }
}

/**
 * Resuelve el bono según la modalidad del empleado y devuelve la liquidación
 * completa. Es el punto de entrada que usan los endpoints.
 */
export function liquidar(ctx: ContextoSolver) {
  const { empleado, novedades } = ctx
  let solver: ResultadoSolver | null = null
  let variableImponible = 0

  if (empleado.modalidad_variable === 'meta_liquido') {
    solver = resolverVariable(ctx, metaLiquido(empleado, novedades))
    variableImponible = solver.variable_imponible
  } else if (empleado.modalidad_variable === 'monto_directo') {
    variableImponible = Math.round(empleado.valor_por_cremacion * novedades.cremaciones)
  }

  const liquidacion = calcularLiquidacion({ ...ctx, variableImponible })
  return { liquidacion, solver }
}
