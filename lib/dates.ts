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
  // IMPORTANTE: el serial representa una fecha LOCAL, no UTC. Si usáramos
  // `new Date(ms)` con ms desde epoch, en zonas UTC- (ej. Chile UTC-3) se
  // mostraría un día antes. Construimos la fecha local a partir de los
  // componentes UTC del epoch shifteado.
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = parseFloat(s)
    if (serial > 1 && serial < 73050) {
      const ms = Math.round((serial - 25569) * 86400 * 1000)
      const utc = new Date(ms)
      if (!isNaN(utc.getTime())) {
        const dt = new Date(
          utc.getUTCFullYear(),
          utc.getUTCMonth(),
          utc.getUTCDate(),
          utc.getUTCHours(),
          utc.getUTCMinutes(),
          utc.getUTCSeconds()
        )
        if (dt.getFullYear() > 1900 && dt.getFullYear() < 2100) return dt
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

/**
 * Formatea una hora como "HH:MM".
 * Acepta:
 *   - "HH:MM" (ya formateado) → devuelve igual
 *   - Serial de Excel (fracción del día: 0.5 = 12:00, 0.4166... = 10:00)
 *   - Vacío/null → ""
 */
export function formatHora(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined || raw === '') return ''
  const s = String(raw).trim()
  if (!s) return ''
  // Formato "HH:MM" o "HH:MM:SS"
  const hhmm = s.match(/^(\d{1,2}):(\d{2})/)
  if (hhmm) {
    const h = String(Math.min(23, Math.max(0, Number(hhmm[1])))).padStart(2, '0')
    return `${h}:${hhmm[2]}`
  }
  // Serial de Excel (fracción de día, 0 ≤ x < 1 — pero Sheets puede devolver x ≥ 1 para horas >= 24h, lo limitamos)
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const f = parseFloat(s)
    if (f >= 0 && f < 2) {
      const totalMin = Math.round(f * 24 * 60)
      const h = Math.floor(totalMin / 60) % 24
      const m = totalMin % 60
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    }
  }
  return s
}

/** Convierte una hora (string "HH:MM" o serial Excel) a minutos desde medianoche. */
export function horaToMinutos(raw: string | number | null | undefined): number | null {
  const s = formatHora(raw)
  if (!s) return null
  const [h, m] = s.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  return h * 60 + m
}
