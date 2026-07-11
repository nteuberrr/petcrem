import { getSupabase, isSupabaseConfigured } from './supabase'

/**
 * Rate limiting simple de intentos de login (NextAuth Credentials, lib/auth.ts).
 * Una fila por intento FALLIDO (email+IP) en `login_intentos`. 5 fallidos en 15
 * minutos → bloqueado (con backoff: el bloqueo se levanta solo cuando el intento
 * más viejo de la ventana sale de los 15 min, no hay que esperar un reset fijo).
 *
 * Tabla solo en Postgres (no forma parte del modelo "Sheets"), por eso usa
 * getSupabase() directo — mismo patrón que correos_log/correos-audit.ts.
 *
 * Fail-open: si Supabase falla, NO bloquea el login (un rate limit caído no debe
 * tumbar el acceso de nadie) — pero si falla el REGISTRO de un intento fallido,
 * tampoco rompe el flujo de auth (best-effort).
 */

const TABLE = 'login_intentos'
const MAX_INTENTOS = 5
const VENTANA_MIN = 15

function norm(email: string): string {
  return (email || '').trim().toLowerCase()
}

/** true si email+IP ya superó el máximo de fallidos en la ventana. */
export async function estaBloqueado(email: string, ip: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false
  try {
    const desde = new Date(Date.now() - VENTANA_MIN * 60_000).toISOString()
    const { count, error } = await getSupabase()
      .from(TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('email', norm(email))
      .eq('ip', ip || '')
      .gte('creado_en', desde)
    if (error) throw error
    return (count ?? 0) >= MAX_INTENTOS
  } catch (e) {
    console.warn('[login-rate-limit] no se pudo verificar bloqueo (fail-open, no bloquea):', e)
    return false
  }
}

/** Registra un intento de login fallido. Best-effort. */
export async function registrarIntentoFallido(email: string, ip: string): Promise<void> {
  if (!isSupabaseConfigured()) return
  try {
    const { error } = await getSupabase().from(TABLE).insert({
      email: norm(email), ip: ip || '', creado_en: new Date().toISOString(),
    })
    if (error) throw error
  } catch (e) {
    console.warn('[login-rate-limit] no se pudo registrar el intento fallido:', e)
  }
}

/** Limpia los intentos fallidos previos tras un login EXITOSO (no arrastrar contador). */
export async function limpiarIntentosFallidos(email: string, ip: string): Promise<void> {
  if (!isSupabaseConfigured()) return
  try {
    await getSupabase().from(TABLE).delete().eq('email', norm(email)).eq('ip', ip || '')
  } catch (e) {
    console.warn('[login-rate-limit] no se pudo limpiar intentos fallidos:', e)
  }
}
