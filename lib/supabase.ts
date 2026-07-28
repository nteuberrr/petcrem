import { createClient, SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (cached) return cached
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Supabase no configurado: faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY')
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cached
}

export function isSupabaseConfigured(): boolean {
  return !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY
}

// ─── Proyecto Supabase dedicado al módulo "Mensajes" ──────────────────────────
// Aislado del proyecto del mailing: otra base, otras credenciales. Así el MCP en
// modo escritura sobre Mensajes no toca el mailing.
let cachedMensajes: SupabaseClient | null = null

export function getMensajesSupabase(): SupabaseClient {
  if (cachedMensajes) return cachedMensajes
  const url = process.env.MENSAJES_SUPABASE_URL
  const key = process.env.MENSAJES_SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Supabase de Mensajes no configurado: faltan MENSAJES_SUPABASE_URL o MENSAJES_SUPABASE_SERVICE_ROLE_KEY')
  }
  cachedMensajes = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cachedMensajes
}

export function isMensajesSupabaseConfigured(): boolean {
  return !!process.env.MENSAJES_SUPABASE_URL && !!process.env.MENSAJES_SUPABASE_SERVICE_ROLE_KEY
}

/**
 * Trae TODAS las filas de una consulta, paginando.
 *
 * ⚠️ PostgREST (Supabase) corta cualquier SELECT en **1000 filas** por defecto y
 * lo hace en SILENCIO: no hay error, simplemente faltan filas. Eso tenía las
 * métricas de campañas en 0 — el agregado leía los 1000 logs MÁS VIEJOS y las
 * campañas nuevas quedaban fuera (2026-07-28, campañas #33 y #35 con 616 logs
 * cada una sobre 2390 en total).
 *
 * Uso: el caller arma la query por página y aplica `.range(desde, hasta)`. La
 * consulta DEBE traer un `.order(...)` estable (típicamente `id`), o la
 * paginación puede repetir/saltear filas.
 *
 *   const { filas } = await traerTodasLasFilas<Row>((desde, hasta) =>
 *     sb.from('mailing_logs').select('...').eq('campana_id', id)
 *       .order('id', { ascending: true }).range(desde, hasta))
 */
export async function traerTodasLasFilas<T>(
  pagina: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  opts: { tam?: number; max?: number } = {},
): Promise<{ filas: T[]; error: string | null; truncado: boolean }> {
  const tam = opts.tam ?? 1000
  const max = opts.max ?? 100_000
  const filas: T[] = []
  for (let desde = 0; desde < max; desde += tam) {
    const { data, error } = await pagina(desde, desde + tam - 1)
    if (error) return { filas, error: error.message, truncado: false }
    const lote = data ?? []
    filas.push(...lote)
    if (lote.length < tam) return { filas, error: null, truncado: false }
  }
  // Tope de seguridad: mejor avisar que quedó corto que fingir el total.
  console.warn(`[supabase] traerTodasLasFilas alcanzó el tope de ${max} filas — resultado truncado`)
  return { filas, error: null, truncado: true }
}

/** Shape de un log row según el schema en Supabase. Todos los timestamps son ISO strings. */
export interface MailingLog {
  id: number
  campana_id: string
  vet_id: string | null
  vet_email: string
  vet_nombre: string | null
  resend_message_id: string | null
  estado: string
  fecha_envio: string | null
  fecha_entrega: string | null
  fecha_apertura: string | null
  fecha_click: string | null
  fecha_rebote: string | null
  motivo_rebote: string | null
  url_clickeada: string | null
  error_msg: string | null
  fecha_creacion: string
}

export type MailingLogInsert = Omit<MailingLog, 'id' | 'fecha_creacion'> & {
  fecha_creacion?: string
}
