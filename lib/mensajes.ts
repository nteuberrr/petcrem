import { getMensajesSupabase } from './supabase'

/**
 * Capa de datos del módulo "Mensajes" (inbox unificado). Todo el acceso es
 * server-side con el service_role (ver lib/supabase.ts). Tablas: mensajes_*
 * (ver supabase/mensajes-schema.sql).
 */

export type Canal = 'whatsapp' | 'instagram' | 'facebook'
export type Audiencia = 'A' | 'B' | 'mixed'
export type Direccion = 'entrante' | 'saliente'
/**
 * Categorías del inbox (ciclo de vida de una conversación):
 *  - activo: entra acá cuando alguien escribe (default).
 *  - cliente: automático al AGENDAR un servicio (retiro de cremación o eutanasia).
 *  - cerrado: automático al hacer la ENTREGA (negocio cerrado, cliente histórico).
 *  - archivado: automático cuando una conversación ACTIVA lleva +2 días sin contacto.
 *  - veterinario: número que está en nuestra base de veterinarios (auto + manual).
 * (Valores legacy 'abierta'/'cerrada' se normalizan a 'activo'/'cerrado'.)
 */
export type EstadoConv = 'activo' | 'cliente' | 'cerrado' | 'archivado' | 'veterinario'
export const ESTADOS_CONV: EstadoConv[] = ['activo', 'cliente', 'veterinario', 'archivado', 'cerrado']

/** Normaliza los estados legacy a los nuevos. */
export function normalizarEstado(e: string | null | undefined): EstadoConv {
  if (e === 'abierta') return 'activo'
  if (e === 'cerrada') return 'cerrado'
  if (e && (ESTADOS_CONV as string[]).includes(e)) return e as EstadoConv
  return 'activo'
}

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
  /** true si llegó un mensaje entrante que aún no se abrió en el inbox. */
  no_leido: boolean
  /** Cuándo se le envió el mensaje de seguimiento automático (null = nunca). */
  seguimiento_at: string | null
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
  // Filtro tolerante a los valores legacy: 'activo' incluye 'abierta', 'cerrado' incluye 'cerrada'.
  if (opts.estado === 'activo') q = q.in('estado', ['activo', 'abierta'])
  else if (opts.estado === 'cerrado') q = q.in('estado', ['cerrado', 'cerrada'])
  else if (opts.estado) q = q.eq('estado', opts.estado)
  if (opts.canal) q = q.eq('canal', opts.canal)
  if (opts.audiencia) q = q.eq('audiencia', opts.audiencia)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  let rows = (data ?? []) as unknown as ConversacionConContacto[]
  if (opts.buscar) {
    const term = opts.buscar.trim()
    const b = term.toLowerCase()
    // Búsqueda DENTRO de las conversaciones: ids de conversaciones cuyos mensajes
    // contienen el término (no solo el nombre/teléfono del contacto).
    let idsPorMensaje = new Set<number>()
    try {
      const { data: msgs } = await sb.from(T_MSG).select('conversacion_id').ilike('cuerpo', `%${term}%`).limit(3000)
      idsPorMensaje = new Set((msgs ?? []).map((m: { conversacion_id: number }) => Number(m.conversacion_id)))
    } catch (e) { console.warn('[mensajes] buscar en cuerpos:', e instanceof Error ? e.message : e) }
    // Las conversaciones que matchean por mensaje pero no estaban entre las
    // recientes ya cargadas → traerlas (respetando los mismos filtros).
    const yaCargadas = new Set(rows.map(r => r.id))
    const faltantes = [...idsPorMensaje].filter(id => !yaCargadas.has(id))
    if (faltantes.length) {
      let q2 = sb.from(T_CONV).select('*, contacto:mensajes_contactos(*)').in('id', faltantes.slice(0, 200))
      if (opts.estado === 'activo') q2 = q2.in('estado', ['activo', 'abierta'])
      else if (opts.estado === 'cerrado') q2 = q2.in('estado', ['cerrado', 'cerrada'])
      else if (opts.estado) q2 = q2.eq('estado', opts.estado)
      if (opts.canal) q2 = q2.eq('canal', opts.canal)
      if (opts.audiencia) q2 = q2.eq('audiencia', opts.audiencia)
      const { data: extra } = await q2
      if (extra?.length) rows = [...rows, ...(extra as unknown as ConversacionConContacto[])]
    }
    rows = rows.filter(r =>
      (r.contacto?.nombre ?? '').toLowerCase().includes(b) ||
      (r.contacto?.telefono ?? '').toLowerCase().includes(b) ||
      idsPorMensaje.has(r.id))
    rows.sort((x, y) => (y.ultimo_mensaje_at ?? '').localeCompare(x.ultimo_mensaje_at ?? ''))
  }
  return rows
}

/**
 * Cantidad de conversaciones con mensajes SIN LEER agrupadas por categoría
 * (estado), para mostrar el "(N)" en cada tab del inbox y saber en qué grupo
 * está el chat sin leer. Normaliza los estados legacy (abierta→activo, etc.).
 */
export async function contarNoLeidosPorCategoria(): Promise<Record<string, number>> {
  try {
    const sb = getMensajesSupabase()
    const { data, error } = await sb.from(T_CONV).select('estado').eq('no_leido', true)
    if (error) return {}
    const out: Record<string, number> = {}
    for (const r of (data ?? []) as { estado: string }[]) {
      const e = r.estado || ''
      const cat = e === 'abierta' ? 'activo' : e === 'cerrada' ? 'cerrado' : e
      out[cat] = (out[cat] || 0) + 1
    }
    return out
  } catch { return {} }
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

/** Elimina una conversación y TODOS sus mensajes (no borra el contacto). */
export async function eliminarConversacion(id: number): Promise<void> {
  const sb = getMensajesSupabase()
  const delMsg = await sb.from(T_MSG).delete().eq('conversacion_id', id)
  if (delMsg.error) throw new Error(delMsg.error.message)
  const delConv = await sb.from(T_CONV).delete().eq('id', id)
  if (delConv.error) throw new Error(delConv.error.message)
}

export async function actualizarConversacion(id: number, patch: Partial<Pick<Conversacion, 'estado' | 'etiquetas' | 'audiencia'>>): Promise<void> {
  const sb = getMensajesSupabase()
  const { error } = await sb.from(T_CONV).update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Archiva las conversaciones ACTIVAS de WhatsApp con más de `dias` sin actividad
 * (último mensaje anterior al corte). Las que se volvieron negocio ya están en
 * 'cliente'/'cerrado', y las de vets en 'veterinario' → no se tocan. Devuelve
 * cuántas archivó. Lo llama el cron diario.
 */
export async function archivarConversacionesInactivas(dias = 2): Promise<number> {
  const sb = getMensajesSupabase()
  const corte = new Date(Date.now() - dias * 86400000).toISOString()
  // Incluye el valor legacy 'abierta' además de 'activo'.
  const { data, error } = await sb.from(T_CONV)
    .update({ estado: 'archivado' })
    .eq('canal', 'whatsapp')
    .in('estado', ['activo', 'abierta'])
    .lt('ultimo_mensaje_at', corte)
    .select('id')
  if (error) { console.warn('[mensajes] archivar inactivas:', error.message); return 0 }
  return (data ?? []).length
}

/** Marca una conversación como leída (al abrirla en el inbox). Best-effort. */
export async function marcarLeida(id: number): Promise<void> {
  try {
    const sb = getMensajesSupabase()
    await sb.from(T_CONV).update({ no_leido: false }).eq('id', id)
  } catch (e) { console.warn('[mensajes] marcarLeida:', e instanceof Error ? e.message : e) }
}

/** Cuenta las conversaciones con mensajes sin leer (para el badge del sidebar). */
export async function contarNoLeidos(): Promise<number> {
  try {
    const sb = getMensajesSupabase()
    const { count } = await sb.from(T_CONV).select('id', { count: 'exact', head: true }).eq('no_leido', true)
    return count ?? 0
  } catch { return 0 }
}

/** Marca que ya se envió el seguimiento automático (idempotencia del barrido). */
export async function marcarSeguimientoEnviado(id: number): Promise<void> {
  const sb = getMensajesSupabase()
  const { error } = await sb.from(T_CONV).update({ seguimiento_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Reclamo ATÓMICO del barrido de seguimiento: pone `seguimiento_barrido_at=now()`
 * en la fila única de agente_config SOLO si el último barrido fue hace más de
 * `intervalMin`. Devuelve true si este proceso ganó el slot (debe correr el
 * barrido), false si otro ya lo hizo hace poco. Evita barridos redundantes cuando
 * el endpoint de 10 min y el botón manual disparan casi a la vez. Best-effort.
 */
export async function reclamarBarridoSeguimiento(intervalMin = 8): Promise<boolean> {
  try {
    const sb = getMensajesSupabase()
    const cutoff = new Date(Date.now() - intervalMin * 60000).toISOString()
    const { data, error } = await sb.from(T_AGENTE)
      .update({ seguimiento_barrido_at: new Date().toISOString() })
      .eq('id', 1)
      .lt('seguimiento_barrido_at', cutoff)
      .select('id')
    if (error) { console.warn('[mensajes] reclamarBarrido:', error.message); return false }
    return (data ?? []).length > 0
  } catch { return false }
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
  // Un mensaje ENTRANTE marca la conversación como NO leída (badge del sidebar).
  const patch: Record<string, unknown> = { ultimo_mensaje_at: ts }
  if (m.direccion === 'entrante') patch.no_leido = true
  await sb.from(T_CONV).update(patch).eq('id', m.conversacion_id)
  return data as Mensaje
}

/** Busca un contacto por wa_id / teléfono / instagram (IGSID) o lo crea. */
export async function upsertContacto(c: {
  wa_id?: string | null
  telefono?: string | null
  /** IGSID (id de usuario de Instagram con respecto a nuestra página). */
  instagram?: string | null
  nombre?: string | null
  audiencia?: Audiencia
}): Promise<Contacto> {
  const sb = getMensajesSupabase()
  if (c.wa_id) {
    const { data } = await sb.from(T_CONTACTOS).select('*').eq('wa_id', c.wa_id).maybeSingle()
    if (data) return data as Contacto
  } else if (c.instagram) {
    const { data } = await sb.from(T_CONTACTOS).select('*').eq('instagram', c.instagram).maybeSingle()
    if (data) return data as Contacto
  } else if (c.telefono) {
    const { data } = await sb.from(T_CONTACTOS).select('*').eq('telefono', c.telefono).maybeSingle()
    if (data) return data as Contacto
  }
  const { data, error } = await sb.from(T_CONTACTOS).insert({
    nombre: c.nombre ?? null,
    telefono: c.telefono ?? null,
    wa_id: c.wa_id ?? null,
    instagram: c.instagram ?? null,
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

const T_AGENTE = 'agente_config'

export interface AgenteConfig {
  instrucciones: string
  calibracion: string
  calibracion_at: string | null
  calibracion_muestra: number | null
  updated_at: string | null
}

const AGENTE_DEFAULT: AgenteConfig = { instrucciones: '', calibracion: '', calibracion_at: null, calibracion_muestra: null, updated_at: null }

/** Lee la config del agente (fila única id=1). Tolera que la tabla aún no exista. */
export async function getAgenteConfig(): Promise<AgenteConfig> {
  const sb = getMensajesSupabase()
  const { data, error } = await sb.from(T_AGENTE).select('*').eq('id', 1).maybeSingle()
  if (error) {
    console.warn('[mensajes] getAgenteConfig:', error.message)
    return AGENTE_DEFAULT // tabla no creada todavía → defaults
  }
  if (!data) return AGENTE_DEFAULT
  return {
    instrucciones: data.instrucciones ?? '',
    calibracion: data.calibracion ?? '',
    calibracion_at: data.calibracion_at ?? null,
    calibracion_muestra: data.calibracion_muestra ?? null,
    updated_at: data.updated_at ?? null,
  }
}

/** Actualiza la config del agente (upsert sobre id=1; preserva columnas no enviadas). */
export async function updateAgenteConfig(patch: Partial<Pick<AgenteConfig, 'instrucciones' | 'calibracion' | 'calibracion_at' | 'calibracion_muestra'>>): Promise<AgenteConfig> {
  const sb = getMensajesSupabase()
  const { error } = await sb.from(T_AGENTE).upsert({ id: 1, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'id' })
  if (error) throw new Error(error.message)
  return getAgenteConfig()
}

/** Muestrea conversaciones recientes (históricas + nuevas) como transcripciones
 *  para calibrar al agente. Recientes primero; solo intercambios reales (≥2 turnos). */
export async function getTranscriptsParaCalibracion(maxConversaciones = 60, maxMsgsPorConv = 40): Promise<string[]> {
  const sb = getMensajesSupabase()
  const { data: convs, error } = await sb.from(T_CONV).select('id')
    .order('ultimo_mensaje_at', { ascending: false, nullsFirst: false }).limit(maxConversaciones)
  if (error) throw new Error(error.message)
  const ids = (convs ?? []).map(c => (c as { id: number }).id)
  if (!ids.length) return []
  const { data: msgs, error: e2 } = await sb.from(T_MSG).select('conversacion_id, direccion, cuerpo, ts')
    .in('conversacion_id', ids).not('cuerpo', 'is', null).order('ts', { ascending: true })
  if (e2) throw new Error(e2.message)
  const porConv = new Map<number, string[]>()
  for (const m of (msgs ?? []) as Array<{ conversacion_id: number; direccion: Direccion; cuerpo: string | null }>) {
    const txt = (m.cuerpo ?? '').trim().slice(0, 400)
    if (!txt) continue
    const arr = porConv.get(m.conversacion_id) ?? []
    arr.push(`${m.direccion === 'entrante' ? 'Cliente' : 'Nosotros'}: ${txt}`)
    porConv.set(m.conversacion_id, arr)
  }
  const transcripts: string[] = []
  for (const id of ids) {
    const lineas = (porConv.get(id) ?? []).slice(-maxMsgsPorConv)
    if (lineas.length >= 2) transcripts.push(lineas.join('\n'))
  }
  return transcripts
}

/** Obtiene o crea la conversación de un contacto en un canal. */
export async function getOrCreateConversacion(contactoId: number, canal: Canal, audiencia: Audiencia = 'A', fuente = 'whatsapp'): Promise<Conversacion> {
  const sb = getMensajesSupabase()
  const { data } = await sb.from(T_CONV).select('*').eq('contacto_id', contactoId).eq('canal', canal).maybeSingle()
  if (data) return data as Conversacion
  const { data: nueva, error } = await sb.from(T_CONV).insert({ contacto_id: contactoId, canal, audiencia, fuente, estado: 'activo' }).select('*').single()
  if (error) throw new Error(error.message)
  return nueva as Conversacion
}

/**
 * Mueve a un estado la(s) conversación(es) de WhatsApp del contacto con ese
 * teléfono (match por últimos 9 dígitos). `soloSi` acota a estados de partida
 * (para no pisar 'veterinario' o 'cerrado' al agendar, p. ej.). Best-effort.
 */
export async function marcarConversacionPorTelefono(
  telefono: string,
  estado: EstadoConv,
  opts: { soloSi?: EstadoConv[] } = {},
): Promise<void> {
  const tel9 = (telefono || '').replace(/\D/g, '').slice(-9)
  if (tel9.length !== 9) return
  try {
    const sb = getMensajesSupabase()
    const { data: contactos } = await sb.from(T_CONTACTOS).select('id')
      .or(`wa_id.eq.56${tel9},wa_id.eq.${tel9},telefono.ilike.%${tel9}`)
    for (const c of (contactos ?? []) as { id: number }[]) {
      const { data: convs } = await sb.from(T_CONV).select('id, estado').eq('contacto_id', c.id).eq('canal', 'whatsapp')
      for (const cv of (convs ?? []) as { id: number; estado: string }[]) {
        if (opts.soloSi && !opts.soloSi.includes(normalizarEstado(cv.estado))) continue
        await sb.from(T_CONV).update({ estado }).eq('id', cv.id)
      }
    }
  } catch (e) {
    console.warn('[mensajes] marcarConversacionPorTelefono falló:', e instanceof Error ? e.message : e)
  }
}
