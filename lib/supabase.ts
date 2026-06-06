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
