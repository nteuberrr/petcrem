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

/** Estados que confirman que el correo SÍ llegó. */
export const ESTADOS_OK = ['entregado', 'abierto', 'clic'] as const

/**
 * Estado final que deja el equipo cuando verificó que el tutor sí recibe en esa
 * dirección (ej. el proveedor reportó un rebote genérico pero la persona
 * confirmó por WhatsApp). Apaga la alerta sin perder el registro: el estado
 * original queda al principio de `motivo`.
 */
export const ESTADO_RESUELTO = 'resuelto'

/** Rango de avance para no "degradar" el estado ante eventos fuera de orden. */
const RANK: Record<string, number> = {
  enviado: 1, entregado: 2, abierto: 3, clic: 4, fallido: 5, rebotado: 5, spam: 6, resuelto: 7,
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
/**
 * TODOS los registros problemáticos (rebotado/spam/fallido), más reciente
 * primero. Para el aviso global de "correos con problemas" en /clientes: el
 * caller cruza contra la ficha (solo alerta si el email VIGENTE del cliente
 * sigue siendo el que rebotó) y dedupe por cliente. Best-effort.
 */
export async function problemasGlobal(limit = 300): Promise<CorreoClienteRow[]> {
  if (!isSupabaseConfigured()) return []
  try {
    const sb = getSupabase()
    const { data, error } = await sb
      .from(TABLE)
      .select('*')
      .in('estado', ESTADOS_PROBLEMA as unknown as string[])
      .order('id', { ascending: false })
      .limit(limit)
    if (error) { console.warn('[correos-log] problemasGlobal:', error.message); return [] }
    const problemas = (data ?? []) as CorreoClienteRow[]
    if (problemas.length === 0) return []

    // Si DESPUÉS del rebote llegó bien un correo a la misma dirección, el
    // problema quedó atrás: se reintentó y la dirección funciona. Sin esto la
    // alerta solo se apagaba cambiando el email de la ficha.
    const emails = Array.from(new Set(problemas.map(p => p.email).filter(Boolean)))
    const { data: ok } = await sb
      .from(TABLE)
      .select('id, email')
      .in('email', emails)
      .in('estado', ESTADOS_OK as unknown as string[])
    const ultimoOk = new Map<string, number>()
    for (const r of (ok ?? []) as { id: string; email: string }[]) {
      const k = (r.email || '').trim().toLowerCase()
      const n = Number(r.id)
      if (!ultimoOk.has(k) || n > ultimoOk.get(k)!) ultimoOk.set(k, n)
    }
    return problemas.filter(p => Number(p.id) > (ultimoOk.get((p.email || '').trim().toLowerCase()) ?? -1))
  } catch (e) {
    console.warn('[correos-log] problemasGlobal:', e instanceof Error ? e.message : String(e))
    return []
  }
}

/**
 * Marca como resueltos los rebotes/fallos pendientes de una dirección: el
 * equipo verificó que el tutor sí recibe ahí. Apaga la alerta en la lista de
 * clientes y en la ficha (afecta a todas las fichas que usen ese correo,
 * porque el rebote es propiedad del email). Devuelve cuántos registros cerró.
 */
export async function resolverProblemasEmail(email: string): Promise<number> {
  const e = (email || '').trim()
  if (!e || !isSupabaseConfigured()) return 0
  try {
    const sb = getSupabase()
    const { data, error } = await sb
      .from(TABLE)
      .select('id, estado, motivo')
      .ilike('email', e)
      .in('estado', ESTADOS_PROBLEMA as unknown as string[])
    if (error) { console.warn('[correos-log] resolverProblemasEmail:', error.message); return 0 }
    const filas = (data ?? []) as { id: string; estado: string; motivo: string }[]
    const ts = nowISO()
    let n = 0
    for (const f of filas) {
      const motivo = `[${f.estado}] ${f.motivo || ''}`.trim().slice(0, 300)
      const { error: upErr } = await sb.from(TABLE)
        .update({ estado: ESTADO_RESUELTO, motivo, fecha_actualizacion: ts })
        .eq('id', f.id)
      if (upErr) console.warn('[correos-log] resolver update:', upErr.message)
      else n++
    }
    return n
  } catch (e2) {
    console.warn('[correos-log] resolverProblemasEmail:', e2 instanceof Error ? e2.message : String(e2))
    return 0
  }
}

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
