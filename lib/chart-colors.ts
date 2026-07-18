/**
 * Paleta ÚNICA para los gráficos (Recharts) de todo el dashboard. Antes cada
 * página definía su propio array ad-hoc y se colaba el indigo viejo `#6366f1`
 * (el mismo tono que ya habíamos migrado fuera del sistema). Fuente única:
 * arranca por el navy + dorado de marca y sigue con hues distinguibles.
 */

export const CHART = {
  navy: '#143C64',   // marca (serie primaria)
  gold: '#F2B84B',   // marca (acento)
  blue: '#2A6DB0',
  green: '#10b981',
  rose: '#ec4899',
  amber: '#f59e0b',
  violet: '#8b5cf6',
  teal: '#14b8a6',
  sky: '#0ea5e9',
  red: '#ef4444',
} as const

/** Secuencia para series múltiples (Pie/Cell, categorías). Empieza por la marca. */
export const CHART_PALETTE: string[] = [
  CHART.navy, CHART.gold, CHART.blue, CHART.green,
  CHART.rose, CHART.amber, CHART.violet, CHART.teal, CHART.sky, CHART.red,
]

/** Ejes y grilla (grises suaves, no compiten con los datos). */
export const CHART_AXIS = '#6b7280'
export const CHART_GRID = '#e5e7eb'
