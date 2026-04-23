export function fmtPrecio(n: number | string): string {
  const num = typeof n === 'string' ? parseFloat(n) || 0 : n
  return `$${num.toLocaleString('es-CL', { maximumFractionDigits: 0 })}`
}

export function fmtNumero(n: number | string, decimales = 0): string {
  const num = typeof n === 'string' ? parseFloat(n) || 0 : n
  return num.toLocaleString('es-CL', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  })
}

export function fmtKg(n: number | string): string {
  const num = typeof n === 'string' ? parseFloat(n) || 0 : n
  return `${fmtNumero(num, num % 1 === 0 ? 0 : 1)} kg`
}

export function fmtLitros(n: number | string): string {
  const num = typeof n === 'string' ? parseFloat(n) || 0 : n
  return `${fmtNumero(num, num % 1 === 0 ? 0 : 1)} L`
}

// Re-export desde lib/dates.ts — mantiene compatibilidad con imports previos.
// El nuevo formato canónico es DD/MM/YYYY (vía formatDate en lib/dates.ts).
export { formatDate as fmtFecha } from './dates'
