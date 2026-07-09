import { getSupabase, isSupabaseConfigured } from './supabase'

/**
 * Registro de correos transaccionales al tutor (tabla correos_cliente en el
 * proyecto Supabase principal). Se inserta una fila al enviar cada correo de
 * etapa y el webhook de Resend la reconcilia (entregado/abierto/rebotado) por
 * message_id. Alimenta el bloque "Correos al tutor" de la ficha y la alerta de
 * rebote del campo email.
 *
 * TODO es best-effort: si Supabase no está configurado o falla, se ignora sin
 * romper el envío (que es la operación importante).
 */

export const TIPOS_CORREO = ['registro', 'inicio_cremacion', 'inicio_despacho', 'entrega', 'certificado', 'cobro_diferencia', 'cobro_adicional', 'boleta'] as const
export type TipoCorreo = typeof TIPOS_CORREO[number]

const TABLE = 'correos_cliente'

/** Estados "malos" que disparan la alerta de rebote en la ficha. */
export const ESTADOS_PROBLEMA = ['rebotado', 'spam', 'fallido'] as const

/** Rango de avance para no "degradar" el estado ante eventos fuera de orden. */
const RANK: Record<string, number> = {
  fallido: 1, enviado: 1, entregado: 2, abierto: 3, clic: 4, rebotado: 5, spam: 6,
}

export interface CorreoClienteRow {
  id: string
  cliente_id: string
  tipo: string
  email: string
  message_id: string
  estado: string
  motivo: string
  fecha_envio: string
  fecha_actualizacion: string
}

export interface RegistroEnvio {
  clienteId?: string
  tipo: TipoCorreo
  email: string
  messageId?: string
  ok: boolean
  error?: string
}

function nowISO(): string {
  return new Date().toISOString()
}

/** Registra uno o varios resultados de envío. Best-effort. */
export async function registrarEnvios(items: RegistroEnvio[]): Promise<void> {
  if (items.length === 0 || !isSupabaseConfigured()) return
  try {
    const ts = nowISO()
    const rows = items.map(it => ({
      cliente_id: it.clienteId || '',
      tipo: it.tipo,
      email: it.email || '',
      message_id: it.messageId || '',
      estado: it.ok ? 'enviado' : 'fallido',
      motivo: it.ok ? '' : (it.error || '').slice(0, 300),
      fecha_envio: ts,
      fecha_actualizacion: ts,
    }))
    const { error } = await getSupabase().from(TABLE).insert(rows)
    if (error) console.warn('[correos-log] insert:', error.message)
  } catch (e) {
    console.warn('[correos-log] registrarEnvios:', e instanceof Error ? e.message : String(e))
  }
}

/** Azúcar para un solo envío. */
export function registrarEnvio(item: RegistroEnvio): Promise<void> {
  return registrarEnvios([item])
}

/**
 * Aplica un evento del webhook de Resend a la fila con ese message_id. No
 * degrada el estado (usa RANK); rebote/spam siempre ganan. Devuelve true si
 * encontró y actualizó la fila. Best-effort.
 */
export async function aplicarEventoCorreo(
  messageId: string,
  nuevoEstado: string,
  motivo: string,
  ts: string,
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false
  try {
    const sb = getSupabase()
    const { data, error } = await sb
      .from(TABLE)
      .select('id, estado')
      .eq('message_id', messageId)
      .limit(1)
    if (error) { console.warn('[correos-log] select evento:', error.message); return false }
    const row = (data?.[0] as { id: string; estado: string } | undefined)
    if (!row) return false
    const actual = RANK[row.estado] ?? 0
    const nuevo = RANK[nuevoEstado] ?? 0
    if (nuevo < actual) {
      // Evento fuera de orden (ej. delivered llega después de opened): no degradar.
      return true
    }
    const updates: Record<string, string> = { estado: nuevoEstado, fecha_actualizacion: ts }
    if (motivo) updates.motivo = motivo.slice(0, 300)
    const { error: upErr } = await sb.from(TABLE).update(updates).eq('id', row.id)
    if (upErr) console.warn('[correos-log] update evento:', upErr.message)
    return true
  } catch (e) {
    console.warn('[correos-log] aplicarEventoCorreo:', e instanceof Error ? e.message : String(e))
    return false
  }
}

/** Lista los correos registrados de un cliente (para el timeline de la ficha). */
export async function listarPorCliente(clienteId: string): Promise<CorreoClienteRow[]> {
  if (!clienteId || !isSupabaseConfigured()) return []
  try {
    const { data, error } = await getSupabase()
      .from(TABLE)
      .select('*')
      .eq('cliente_id', String(clienteId))
      .order('id', { ascending: true })
    if (error) { console.warn('[correos-log] listarPorCliente:', error.message); return [] }
    return (data ?? []) as CorreoClienteRow[]
  } catch (e) {
    console.warn('[correos-log] listarPorCliente:', e instanceof Error ? e.message : String(e))
    return []
  }
}

/**
 * Devuelve el último registro PROBLEMÁTICO (rebotado/spam/fallido) para una
 * dirección de email, o null. El rebote es propiedad del email, no del cliente,
 * por eso se busca por email. Para la alerta del campo email en la ficha.
 */
export async function problemaPorEmail(email: string): Promise<CorreoClienteRow | null> {
  const e = (email || '').trim()
  if (!e || !isSupabaseConfigured()) return null
  try {
    const { data, error } = await getSupabase()
      .from(TABLE)
      .select('*')
      .eq('email', e)
      .in('estado', ESTADOS_PROBLEMA as unknown as string[])
      .order('id', { ascending: false })
      .limit(1)
    if (error) { console.warn('[correos-log] problemaPorEmail:', error.message); return null }
    return (data?.[0] as CorreoClienteRow | undefined) ?? null
  } catch (e2) {
    console.warn('[correos-log] problemaPorEmail:', e2 instanceof Error ? e2.message : String(e2))
    return null
  }
}
