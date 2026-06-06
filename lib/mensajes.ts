import { getMensajesSupabase } from './supabase'

/**
 * Capa de datos del módulo "Mensajes" (inbox unificado). Todo el acceso es
 * server-side con el service_role (ver lib/supabase.ts). Tablas: mensajes_*
 * (ver supabase/mensajes-schema.sql).
 */

export type Canal = 'whatsapp' | 'instagram' | 'facebook'
export type Audiencia = 'A' | 'B' | 'mixed'
export type Direccion = 'entrante' | 'saliente'
export type EstadoConv = 'abierta' | 'cerrada'

export interface Contacto {
  id: number
  nombre: string | null
  telefono: string | null
  wa_id: string | null
  instagram: string | null
  facebook_id: string | null
  audiencia: Audiencia
  cliente_id: string | null
  notas: string | null
  created_at: string
  updated_at: string
}

export interface Conversacion {
  id: number
  contacto_id: number
  canal: Canal
  audiencia: Audiencia
  estado: EstadoConv
  etiquetas: string[]
  fuente: string
  provider_conversation_id: string | null
  ultimo_mensaje_at: string | null
  created_at: string
}

export interface Mensaje {
  id: number
  conversacion_id: number
  direccion: Direccion
  cuerpo: string | null
  tipo: string
  media_url: string | null
  provider_message_id: string | null
  estado: string | null
  enviado_por: string | null
  ts: string
  created_at: string
}

export type ConversacionConContacto = Conversacion & { contacto: Contacto | null }

const T_CONTACTOS = 'mensajes_contactos'
const T_CONV = 'mensajes_conversaciones'
const T_MSG = 'mensajes_mensajes'

export const ETIQUETAS_DISPONIBLES = ['consulta', 'cotizacion', 'agendado', 'seguimiento', 'urgente', 'convenio'] as const

/** Lista conversaciones (con su contacto) ordenadas por actividad reciente. */
export async function listConversaciones(opts: {
  estado?: EstadoConv
  canal?: Canal
  audiencia?: Audiencia
  buscar?: string
  limit?: number
} = {}): Promise<ConversacionConContacto[]> {
  const sb = getMensajesSupabase()
  let q = sb.from(T_CONV).select('*, contacto:mensajes_contactos(*)').order('ultimo_mensaje_at', { ascending: false, nullsFirst: false }).limit(opts.limit ?? 300)
  if (opts.estado) q = q.eq('estado', opts.estado)
  if (opts.canal) q = q.eq('canal', opts.canal)
  if (opts.audiencia) q = q.eq('audiencia', opts.audiencia)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  let rows = (data ?? []) as unknown as ConversacionConContacto[]
  if (opts.buscar) {
    const b = opts.buscar.toLowerCase()
    rows = rows.filter(r =>
      (r.contacto?.nombre ?? '').toLowerCase().includes(b) ||
      (r.contacto?.telefono ?? '').toLowerCase().includes(b))
  }
  return rows
}

export async function getConversacion(id: number): Promise<ConversacionConContacto | null> {
  const sb = getMensajesSupabase()
  const { data, error } = await sb.from(T_CONV).select('*, contacto:mensajes_contactos(*)').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as unknown as ConversacionConContacto) ?? null
}

export async function getMensajes(conversacionId: number): Promise<Mensaje[]> {
  const sb = getMensajesSupabase()
  const { data, error } = await sb.from(T_MSG).select('*').eq('conversacion_id', conversacionId).order('ts', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as Mensaje[]
}

export async function actualizarConversacion(id: number, patch: Partial<Pick<Conversacion, 'estado' | 'etiquetas' | 'audiencia'>>): Promise<void> {
  const sb = getMensajesSupabase()
  const { error } = await sb.from(T_CONV).update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function vincularCliente(contactoId: number, clienteId: string | null): Promise<void> {
  const sb = getMensajesSupabase()
  const { error } = await sb.from(T_CONTACTOS).update({ cliente_id: clienteId, updated_at: new Date().toISOString() }).eq('id', contactoId)
  if (error) throw new Error(error.message)
}

/** Inserta un mensaje y actualiza ultimo_mensaje_at de la conversación. */
export async function insertarMensaje(m: {
  conversacion_id: number
  direccion: Direccion
  cuerpo?: string | null
  tipo?: string
  media_url?: string | null
  provider_message_id?: string | null
  estado?: string | null
  enviado_por?: string | null
  ts?: string
}): Promise<Mensaje> {
  const sb = getMensajesSupabase()
  const ts = m.ts ?? new Date().toISOString()
  const { data, error } = await sb.from(T_MSG).insert({
    conversacion_id: m.conversacion_id,
    direccion: m.direccion,
    cuerpo: m.cuerpo ?? null,
    tipo: m.tipo ?? 'texto',
    media_url: m.media_url ?? null,
    provider_message_id: m.provider_message_id ?? null,
    estado: m.estado ?? null,
    enviado_por: m.enviado_por ?? null,
    ts,
  }).select('*').single()
  if (error) throw new Error(error.message)
  await sb.from(T_CONV).update({ ultimo_mensaje_at: ts }).eq('id', m.conversacion_id)
  return data as Mensaje
}

/** Busca un contacto por wa_id / teléfono o lo crea. */
export async function upsertContacto(c: {
  wa_id?: string | null
  telefono?: string | null
  nombre?: string | null
  audiencia?: Audiencia
}): Promise<Contacto> {
  const sb = getMensajesSupabase()
  if (c.wa_id) {
    const { data } = await sb.from(T_CONTACTOS).select('*').eq('wa_id', c.wa_id).maybeSingle()
    if (data) return data as Contacto
  } else if (c.telefono) {
    const { data } = await sb.from(T_CONTACTOS).select('*').eq('telefono', c.telefono).maybeSingle()
    if (data) return data as Contacto
  }
  const { data, error } = await sb.from(T_CONTACTOS).insert({
    nombre: c.nombre ?? null,
    telefono: c.telefono ?? null,
    wa_id: c.wa_id ?? null,
    audiencia: c.audiencia ?? 'A',
  }).select('*').single()
  if (error) throw new Error(error.message)
  return data as Contacto
}

/** ¿Ya existe un mensaje con ese provider_message_id? (dedupe de webhooks). */
export async function existeMensajePorProvider(providerMessageId: string): Promise<boolean> {
  const sb = getMensajesSupabase()
  const { data } = await sb.from(T_MSG).select('id').eq('provider_message_id', providerMessageId).maybeSingle()
  return !!data
}

/** Marca el estado de un mensaje saliente por su provider_message_id (status webhook). */
export async function marcarEstadoMensaje(providerMessageId: string, estado: string): Promise<void> {
  const sb = getMensajesSupabase()
  await sb.from(T_MSG).update({ estado }).eq('provider_message_id', providerMessageId)
}

/** Obtiene o crea la conversación de un contacto en un canal. */
export async function getOrCreateConversacion(contactoId: number, canal: Canal, audiencia: Audiencia = 'A', fuente = 'whatsapp'): Promise<Conversacion> {
  const sb = getMensajesSupabase()
  const { data } = await sb.from(T_CONV).select('*').eq('contacto_id', contactoId).eq('canal', canal).maybeSingle()
  if (data) return data as Conversacion
  const { data: nueva, error } = await sb.from(T_CONV).insert({ contacto_id: contactoId, canal, audiencia, fuente }).select('*').single()
  if (error) throw new Error(error.message)
  return nueva as Conversacion
}
