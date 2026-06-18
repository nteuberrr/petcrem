import { getSupabase, isSupabaseConfigured } from './supabase'

/**
 * Registro/respaldo de TODOS los correos transaccionales enviados (tutor + vet +
 * eutanasia; NO las campañas de mailing). Tabla `correos_log` en el proyecto
 * Supabase principal. Lo escribe sendEmail/sendBatch (lib/resend-mailer) cuando
 * el envío trae el campo `seguimiento`. Guarda el cuerpo HTML (sin adjuntos)
 * para poder reabrir el correo desde Configuración → Correos.
 *
 * TODO es best-effort: si Supabase no está / falla, se ignora sin romper el envío.
 */

const TABLE = 'correos_log'

export interface CorreoLogEntry {
  tipo: string
  audiencia?: string
  destinatario: string
  asunto: string
  codigo?: string
  nombre?: string
  clienteId?: string
  messageId?: string
  ok: boolean
  error?: string
  html?: string
}

function nowISO(): string {
  return new Date().toISOString()
}

/** Inserta un correo en el registro. Best-effort (id lo asigna la identity). */
export async function registrarCorreoLog(e: CorreoLogEntry): Promise<void> {
  if (!isSupabaseConfigured()) return
  try {
    const ts = nowISO()
    const { error } = await getSupabase().from(TABLE).insert({
      fecha_envio: ts,
      tipo: e.tipo || '',
      audiencia: e.audiencia || '',
      destinatario: e.destinatario || '',
      asunto: e.asunto || '',
      cliente_id: e.clienteId || '',
      codigo: e.codigo || '',
      nombre: e.nombre || '',
      message_id: e.messageId || '',
      estado: e.ok ? 'enviado' : 'fallido',
      motivo: e.ok ? '' : (e.error || '').slice(0, 500),
      html: e.html || '',
      fecha_creacion: ts,
    })
    if (error) console.warn('[correos-audit] insert:', error.message)
  } catch (err) {
    console.warn('[correos-audit] registrarCorreoLog:', err instanceof Error ? err.message : String(err))
  }
}

export interface CorreoLogRow {
  id: string
  fecha_envio: string
  tipo: string
  audiencia: string
  destinatario: string
  asunto: string
  cliente_id: string
  codigo: string
  nombre: string
  message_id: string
  estado: string
  motivo: string
  fecha_creacion: string
}

export interface ListarCorreoLogParams {
  desde?: string // fecha Chile YYYY-MM-DD (inclusive)
  hasta?: string // fecha Chile YYYY-MM-DD (inclusive)
  q?: string // busca en destinatario / codigo / nombre / asunto / tipo
  page?: number // 1-based
  pageSize?: number
}

export interface ListarCorreoLogResult {
  items: CorreoLogRow[]
  total: number
  page: number
  pageSize: number
}

// Columnas de la lista — sin `html` (pesado; se trae aparte para el visor).
const COLS_LISTA =
  'id,fecha_envio,tipo,audiencia,destinatario,asunto,cliente_id,codigo,nombre,message_id,estado,motivo,fecha_creacion'

/**
 * Offset de Chile respecto de UTC (3 o 4 h) en una fecha dada, para convertir el
 * rango de fechas elegido (en hora de Chile) a límites UTC sobre fecha_envio
 * (que se guarda en UTC). Evita correr el filtro ±4 h en los bordes del día.
 */
function chileOffsetHoras(fechaISO: string): number {
  try {
    const d = new Date(`${fechaISO}T12:00:00Z`)
    const h = parseInt(
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santiago', hour: 'numeric', hour12: false }).format(d),
      10,
    )
    if (Number.isFinite(h)) return 12 - h
  } catch { /* */ }
  return 4
}

export async function listarCorreoLog(p: ListarCorreoLogParams = {}): Promise<ListarCorreoLogResult> {
  const page = Math.max(1, p.page || 1)
  const pageSize = Math.min(100, Math.max(1, p.pageSize || 10))
  if (!isSupabaseConfigured()) return { items: [], total: 0, page, pageSize }
  try {
    let query = getSupabase().from(TABLE).select(COLS_LISTA, { count: 'exact' })

    if (p.desde) {
      const off = chileOffsetHoras(p.desde)
      query = query.gte('fecha_envio', new Date(`${p.desde}T00:00:00-0${off}:00`).toISOString())
    }
    if (p.hasta) {
      const off = chileOffsetHoras(p.hasta)
      query = query.lte('fecha_envio', new Date(`${p.hasta}T23:59:59-0${off}:00`).toISOString())
    }

    const q = (p.q || '').trim()
    if (q) {
      // Sanitiza para el operador .or de PostgREST (coma y % son separadores/comodín).
      const esc = q.replace(/[%,()]/g, ' ').trim()
      if (esc) {
        query = query.or(
          ['destinatario', 'codigo', 'nombre', 'asunto', 'tipo'].map(c => `${c}.ilike.%${esc}%`).join(','),
        )
      }
    }

    const from = (page - 1) * pageSize
    query = query.order('fecha_envio', { ascending: false }).range(from, from + pageSize - 1)

    const { data, error, count } = await query
    if (error) {
      console.warn('[correos-audit] listar:', error.message)
      return { items: [], total: 0, page, pageSize }
    }
    return { items: (data ?? []) as CorreoLogRow[], total: count ?? 0, page, pageSize }
  } catch (e) {
    console.warn('[correos-audit] listarCorreoLog:', e instanceof Error ? e.message : String(e))
    return { items: [], total: 0, page, pageSize }
  }
}

/** Trae un correo completo (incluye html) para el visor. */
export async function obtenerCorreoLog(id: string): Promise<(CorreoLogRow & { html: string }) | null> {
  if (!id || !isSupabaseConfigured()) return null
  try {
    const { data, error } = await getSupabase().from(TABLE).select('*').eq('id', String(id)).limit(1)
    if (error) {
      console.warn('[correos-audit] obtener:', error.message)
      return null
    }
    return (data?.[0] as (CorreoLogRow & { html: string }) | undefined) ?? null
  } catch (e) {
    console.warn('[correos-audit] obtenerCorreoLog:', e instanceof Error ? e.message : String(e))
    return null
  }
}
