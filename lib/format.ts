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

export function fmtFecha(v: string | Date | null | undefined): string {
  if (!v) return ''
  let d: Date
  if (v instanceof Date) {
    d = v
  } else {
    const s = String(v).trim()
    if (!s) return ''
    // ISO yyyy-mm-dd | yyyy-mm-ddTHH:mm:ss
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`
    // dd-mm-yyyy or dd/mm/yyyy
    const dmy = s.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})/)
    if (dmy) return `${dmy[1]}-${dmy[2]}-${dmy[3]}`
    d = new Date(s)
  }
  if (isNaN(d.getTime())) return String(v)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}-${mm}-${yyyy}`
}
