/**
 * Parsea un string a número aceptando coma o punto como separador decimal.
 * - "12,5"     → 12.5
 * - "1.234,56" → 1234.56  (formato europeo: punto miles, coma decimal)
 * - "12.5"     → 12.5     (formato US: punto decimal)
 * - "1234"     → 1234
 * Devuelve null si no es parseable.
 */
export function parseDecimal(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  const tienePunto = s.includes('.')
  const tieneComa = s.includes(',')
  let normalized: string
  if (tienePunto && tieneComa) {
    normalized = s.replace(/\./g, '').replace(',', '.')
  } else if (tieneComa) {
    normalized = s.replace(',', '.')
  } else {
    normalized = s
  }
  const n = parseFloat(normalized)
  return Number.isFinite(n) ? n : null
}

/** Parsea o devuelve 0 si no es válido — útil para sumas y agregaciones. */
export function parseDecimalOr0(v: unknown): number {
  return parseDecimal(v) ?? 0
}

/**
 * Normaliza un peso de mascota detectando escalamiento erróneo.
 *
 * Caso típico: alguien escribió "12.5" en una planilla con locale es-CL → Sheets
 * lo interpretó como 12.500 (punto = separador de miles) y lo guardó como número
 * 12500. Cuando lo leemos, no podemos saber el original; solo que es absurdo
 * para una mascota.
 *
 * Regla: las mascotas reales pesan entre 0.05 y ~150 kg. Si lee más alto,
 * dividimos por la potencia de 10 que lo deje en rango razonable.
 */
export function normalizarPeso(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0
  if (n <= 150) return n
  if (n <= 1500) return n / 10        // ej: 125 → 12.5
  if (n <= 15000) return n / 100      // ej: 1250 → 12.5
  if (n <= 150000) return n / 1000    // ej: 12500 → 12.5
  return n / 10000                     // muy raro: 125000 → 12.5
}

/**
 * Parsea un peso aceptando string ("12,5", "12.5") o número, y aplica
 * normalizarPeso para corregir escalamiento heredado de Sheets es-CL.
 */
export function parsePeso(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0
  if (typeof v === 'number') return normalizarPeso(v)
  const n = parseDecimal(v)
  return n === null ? 0 : normalizarPeso(n)
}

/**
 * Normaliza un monto en CLP detectando escalamiento erróneo.
 *
 * Caso típico: alguien escribió "$120.500" en una planilla con locale es-CL →
 * Sheets lo interpretó como decimal (120.5) y lo guardó como 120.5 en lugar
 * de 120500.
 *
 * Regla: los montos en CLP son enteros (no hay centavos). Si el valor es < 1000
 * pero tiene parte decimal, lo más probable es que sea escalamiento (multiplicar
 * por 1000). Solo aplicamos cuando es decimal — un monto entero pequeño (ej. $500)
 * se respeta.
 */
export function normalizarMonto(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0
  // Si tiene decimales y es chico, casi seguro fue escalado mal por Sheets es-CL.
  // Ej: "120.500" leído como 120.5 → 120500
  if (n < 1000 && n % 1 !== 0) {
    let scaled = n
    while (scaled < 1000) scaled *= 1000
    return Math.round(scaled / 1000) * 1000  // redondear a miles
  }
  return n
}

/**
 * Parsea un monto en CLP. Strings con punto/coma se tratan como separador
 * de miles ("120.500" → 120500, "120,500" → 120500, "1.234.567" → 1234567).
 * Solo si hay TANTO punto como coma se asume formato europeo decimal.
 */
export function parseMonto(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0
  if (typeof v === 'number') return normalizarMonto(v)
  if (typeof v !== 'string') return 0
  let s = v.trim()
  if (!s) return 0
  // Quitar símbolos de moneda y espacios
  s = s.replace(/[$\s]/g, '')
  if (!s) return 0
  const tienePunto = s.includes('.')
  const tieneComa = s.includes(',')
  if (tienePunto && tieneComa) {
    // Formato europeo: el último separador es decimal.
    const ultPunto = s.lastIndexOf('.')
    const ultComa = s.lastIndexOf(',')
    if (ultComa > ultPunto) {
      // "1.234,50" → 1234.50
      s = s.replace(/\./g, '').replace(',', '.')
    } else {
      // "1,234.50" → 1234.50
      s = s.replace(/,/g, '')
    }
  } else {
    // Solo punto o solo coma → ambos como separador de miles (CLP no tiene decimales).
    s = s.replace(/[.,]/g, '')
  }
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : 0
}
