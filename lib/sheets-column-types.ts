import { parseFecha, formatHora } from './dates'

// ─────────────────────────────────────────────────────────────────────────────
// Clasificación de columnas para NORMALIZAR fechas/horas/booleanos al migrar a
// Postgres (texto). El problema: Sheets, leído con UNFORMATTED_VALUE, devuelve:
//   - fechas  → serial de Excel (ej. 46131), entero = solo fecha, con fracción = fecha+hora.
//   - horas   → fracción de día (ej. 0.6667 = 16:00).
//   - booleanos → true/false (primitivo) o "TRUE"/"FALSE".
// Y la app, de aquí en adelante, escribe ISO ("YYYY-MM-DD" / "...THH:MM:SS") y "HH:MM".
//
// Para que la columna text quede CONSISTENTE (y ordene/filtre bien), el import
// convierte todo a forma canónica:
//   - fecha sola      → "YYYY-MM-DD"
//   - fecha + hora    → "YYYY-MM-DDTHH:MM:SS"  (local, sin shift UTC)
//   - hora            → "HH:MM"
//   - booleano        → "TRUE" / "FALSE"
//
// IMPORTANTE: solo se convierten columnas DE FECHA/HORA conocidas por nombre. Las
// numéricas (peso, lat, lng, precio, monto, litros…) caen en rango de serial y NO
// deben tocarse — por eso la clasificación es explícita, no "cualquier número".
// ─────────────────────────────────────────────────────────────────────────────

/** Columnas de hora "HH:MM" (en Sheets viven como fracción de día). */
export const COLUMNAS_HORA = new Set<string>([
  'hora', 'hora_inicio', 'hora_fin', 'hora_inicio_ruta', 'hora_termino_ruta',
  'hora_entrada', 'hora_salida', 'hora_emision', 'hora_envio', 'hora_servicio',
  'hora_retiro', 'enviado_ultima_hora',
])

/** Columnas booleanas (round-trip "TRUE"/"FALSE"). */
export const COLUMNAS_BOOL = new Set<string>([
  'misma_direccion', 'activo', 'es_findesemana', 'suscrito', 'sin_foto',
  'datos_pago_completos', 'email_seguimiento_activo',
])

/** Una columna es de fecha si su nombre arranca con "fecha" o es una excepción conocida. */
export function esColumnaFecha(col: string): boolean {
  return col.startsWith('fecha') || col === 'vigente_desde' || col === 'enviado_ultima_fecha'
}
export function esColumnaHora(col: string): boolean { return COLUMNAS_HORA.has(col) }
export function esColumnaBool(col: string): boolean { return COLUMNAS_BOOL.has(col) }

function pad(n: number): string { return String(n).padStart(2, '0') }
function aISOFecha(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
function aISOFechaHora(d: Date): string {
  return `${aISOFecha(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * Normaliza un valor crudo del respaldo (Sheets/UNFORMATTED_VALUE) a la forma
 * canónica que se guarda en Postgres (texto). Pensada para el import.
 */
export function normalizarCelda(col: string, raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  if (typeof raw === 'boolean') return raw ? 'TRUE' : 'FALSE'
  const s = String(raw).trim()
  if (s === '') return ''

  if (esColumnaHora(col)) {
    const hhmm = formatHora(raw as string | number) // fracción→HH:MM o HH:MM tal cual
    return hhmm || s
  }

  if (esColumnaFecha(col)) {
    const num = Number(s)
    // Detecta fecha vs fecha+hora: serial con fracción, o string ISO con hora.
    const tieneHora = Number.isFinite(num) && /^\d+(\.\d+)?$/.test(s)
      ? !Number.isInteger(num)
      : /[T ]\d{1,2}:\d{2}/.test(s)
    const d = parseFecha(raw as string)
    if (!d) return s
    return tieneHora ? aISOFechaHora(d) : aISOFecha(d)
  }

  if (esColumnaBool(col)) {
    const up = s.toUpperCase()
    if (up === 'TRUE' || up === 'VERDADERO' || up === '1') return 'TRUE'
    if (up === 'FALSE' || up === 'FALSO' || up === '0') return 'FALSE'
    return s
  }

  return s
}
