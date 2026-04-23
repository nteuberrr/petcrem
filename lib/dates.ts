/**
 * Utilidades de fecha centralizadas.
 *
 * Regla general del proyecto:
 * - En Google Sheets y en inputs HTML date: formato ISO (YYYY-MM-DD o YYYY-MM-DDTHH:mm:ss)
 * - En la UI visible al usuario: DD/MM/YYYY
 */

function parse(dateStr: string | Date | null | undefined): Date | null {
  if (!dateStr) return null
  if (dateStr instanceof Date) return isNaN(dateStr.getTime()) ? null : dateStr
  const s = String(dateStr).trim()
  if (!s) return null

  // ISO: 2026-04-21 o 2026-04-21T14:30:00
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (iso) {
    const [, y, m, d, hh = '12', mm = '00', ss = '00'] = iso
    const dt = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss))
    return isNaN(dt.getTime()) ? null : dt
  }

  // Formatos con / o -: DD/MM/YYYY, DD-MM-YYYY
  const dmy = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/)
  if (dmy) {
    const dt = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]), 12, 0, 0)
    return isNaN(dt.getTime()) ? null : dt
  }

  // Serial de Excel/Sheets: número entre ~1 y ~73050 (años 1900-2100).
  // Google Sheets con UNFORMATTED_VALUE devuelve fechas como este serial.
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = parseFloat(s)
    if (serial > 1 && serial < 73050) {
      // Excel serial 25569 = 1970-01-01 (con bug de 1900 bisiesto que "corrige" esto)
      const ms = Math.round((serial - 25569) * 86400 * 1000)
      const dt = new Date(ms)
      if (!isNaN(dt.getTime()) && dt.getFullYear() > 1900 && dt.getFullYear() < 2100) {
        return dt
      }
    }
  }

  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

/** Hoy en formato YYYY-MM-DD para usar en <input type="date"> — evita UTC shift */
export function todayISO(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/** Para mostrar: "15/01/2025" */
export function formatDate(dateStr: string | Date | null | undefined): string {
  const d = parse(dateStr)
  if (!d) return ''
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}

/** Para mostrar: "15/01/2025 14:30" */
export function formatDateTime(dateStr: string | Date | null | undefined): string {
  const d = parse(dateStr)
  if (!d) return ''
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`
}

/** Para guardar en Sheets / usar en inputs HTML: "2025-01-15" */
export function formatDateForSheet(date: Date | string | null | undefined): string {
  const d = parse(date)
  if (!d) return ''
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${yyyy}-${mm}-${dd}`
}

/** Calcula días transcurridos desde una fecha hasta hoy (positivo si es pasada) */
export function daysSince(dateStr: string | Date | null | undefined): number | null {
  const d = parse(dateStr)
  if (!d) return null
  const diffMs = Date.now() - d.getTime()
  return Math.floor(diffMs / (1000 * 60 * 60 * 24))
}
