/**
 * Tablas legales y valores por defecto de Remuneraciones.
 *
 * Nada de esto es una constante intocable: son los DEFAULTS con que se siembra
 * un período nuevo en `rrhh_parametros`. Lo que manda al calcular es siempre la
 * fila del período, que el dueño puede editar. Esto es justo lo que le faltaba
 * al Excel, que quedó congelado con los topes de 2025.
 */

import type { Parametros, TramoImpuesto } from './tipos'

/** AFP disponibles y su cotización total (10% obligatorio + comisión), en %. */
export const TASAS_AFP: Record<string, number> = {
  capital: 11.44,
  cuprum: 11.44,
  habitat: 11.27,
  modelo: 10.58,
  planvital: 11.16,
  provida: 11.45,
  uno: 10.46,
}

export const NOMBRES_AFP: Record<string, string> = {
  capital: 'Capital',
  cuprum: 'Cuprum',
  habitat: 'Habitat',
  modelo: 'Modelo',
  planvital: 'Plan Vital',
  provida: 'Provida',
  uno: 'Uno',
}

/**
 * Impuesto Único de Segunda Categoría (tabla mensual, expresada en UTM).
 * Nota: el Excel tenía la rebaja del último tramo fija en $1.930.246,86
 * (≈27 UTM); la legal son 38,82 UTM. No afectaba a estos sueldos, pero está
 * corregido acá.
 */
export const TRAMOS_IUSC: TramoImpuesto[] = [
  { desde_utm: 0, hasta_utm: 13.5, tasa: 0, rebaja_utm: 0 },
  { desde_utm: 13.5, hasta_utm: 30, tasa: 0.04, rebaja_utm: 0.54 },
  { desde_utm: 30, hasta_utm: 50, tasa: 0.08, rebaja_utm: 1.74 },
  { desde_utm: 50, hasta_utm: 70, tasa: 0.135, rebaja_utm: 4.49 },
  { desde_utm: 70, hasta_utm: 90, tasa: 0.23, rebaja_utm: 11.14 },
  { desde_utm: 90, hasta_utm: 120, tasa: 0.304, rebaja_utm: 17.8 },
  { desde_utm: 120, hasta_utm: 310, tasa: 0.35, rebaja_utm: 23.32 },
  { desde_utm: 310, hasta_utm: null, tasa: 0.4, rebaja_utm: 38.82 },
]

export const ISAPRES = [
  'Banmédica', 'Colmena', 'Consalud', 'Cruz Blanca', 'Esencial', 'Nueva Masvida', 'Vida Tres',
]

/**
 * Reforma previsional (Ley 21.735): el aporte del empleador sube por tramos
 * durante nueve años. Hasta las remuneraciones de JULIO 2026 el empleador paga
 * el SIS por separado (≈1,38%) más el 1% nuevo (0,1% a la cuenta individual +
 * 0,9% al FAPP). Desde AGOSTO 2026 el total pasa a 3,5% y el SIS queda
 * ABSORBIDO dentro del 2,5% de seguro social — la línea separada desaparece.
 */
export function aportesPrevisionalesPorPeriodo(periodo: string): {
  tasa_sis: number
  tasa_cuenta_individual: number
  tasa_fapp: number
  tasa_seguro_social: number
} {
  if (periodo >= '2026-08') {
    return { tasa_sis: 0, tasa_cuenta_individual: 0.1, tasa_fapp: 0.9, tasa_seguro_social: 2.5 }
  }
  return { tasa_sis: 1.38, tasa_cuenta_individual: 0.1, tasa_fapp: 0.9, tasa_seguro_social: 0 }
}

/**
 * Topes imponibles. Se reajustan cada año y rigen desde las remuneraciones de
 * FEBRERO. 2025: 87,8 / 131,9 UF. 2026: 90,0 / 135,2 UF.
 */
export function topesPorPeriodo(periodo: string): { tope_afp_uf: number; tope_afc_uf: number } {
  if (periodo >= '2026-02') return { tope_afp_uf: 90.0, tope_afc_uf: 135.2 }
  return { tope_afp_uf: 87.8, tope_afc_uf: 131.9 }
}

/** Ingreso mínimo mensual: $529.000 desde may-2025, $539.000 desde ene-2026. */
export function immPorPeriodo(periodo: string): number {
  if (periodo >= '2026-01') return 539000
  return 529000
}

/**
 * Parámetros por defecto de un período. `valor_uf` y `valor_utm` NO se pueden
 * derivar (los publica el Banco Central / SII cada mes), así que se dejan en 0
 * y la UI obliga a completarlos antes de calcular.
 */
export function parametrosPorDefecto(periodo: string): Parametros {
  return {
    periodo,
    valor_uf: 0,
    valor_utm: 0,
    imm: immPorPeriodo(periodo),
    ...topesPorPeriodo(periodo),
    tasas_afp: { ...TASAS_AFP },
    tramos_impuesto: TRAMOS_IUSC.map(t => ({ ...t })),
    tasa_afc_trabajador: 0.6,
    tasa_afc_empleador_indefinido: 2.4,
    tasa_afc_empleador_plazo_fijo: 3,
    tasa_mutual: 0.95,
    ...aportesPrevisionalesPorPeriodo(periodo),
    factor_gratificacion: 0.25,
    tope_gratificacion_imm: 4.75,
  }
}
