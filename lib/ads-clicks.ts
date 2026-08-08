import { getSupabase } from './supabase'

/**
 * ATRIBUCIÓN DE GOOGLE ADS — capa de datos de `ads_clicks`.
 *
 * Cierra el hueco entre el clic en el anuncio y la ficha real. El recorrido
 * completo está documentado en supabase/migracion-ads-clicks.sql; acá van las
 * cinco operaciones que lo sostienen:
 *
 *   registrarClick()        la landing vio un gclid  → devuelve el código corto
 *   vincularTelefono()      llegó un WhatsApp con ese código
 *   vincularClientePorTelefono()  ese teléfono terminó en una ficha
 *   pendientesDeSubir()     fichas listas para informar a Ads
 *   marcarSubidos()         ya informadas
 *
 * ⚠️ TODO acá es best-effort y NUNCA lanza: si la tabla todavía no existe (el
 * DDL se corre a mano en Supabase, ver CLAUDE.md) o Supabase está caído, la
 * medición se pierde pero no puede tumbar el sitio, el bot ni el alta de fichas.
 */

export interface AdsClick {
  id: number
  codigo: string
  gclid: string | null
  gbraid: string | null
  wbraid: string | null
  landing: string | null
  telefono: string | null
  cliente_id: string | null
  vinculado_at: string | null
  subido_at: string | null
  created_at: string
}

const TABLA = 'ads_clicks'

/** Alfabeto sin caracteres que se confunden al leerlos (0/O, 1/I/L). */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const LARGO = 6

/** El marcador tal como viaja dentro del mensaje de WhatsApp: `[#ABC234]`. */
export const RE_MARCADOR = new RegExp(`\\[#([${ALFABETO}]{${LARGO}})\\]`, 'i')

function nuevoCodigo(): string {
  let s = ''
  for (let i = 0; i < LARGO; i++) s += ALFABETO[Math.floor(Math.random() * ALFABETO.length)]
  return s
}

/** Últimos 9 dígitos — la forma en que el resto del sistema compara teléfonos. */
export function tel9(v: string | null | undefined): string {
  return String(v ?? '').replace(/\D/g, '').slice(-9)
}

/** Quita el marcador del texto (el operador y el agente no tienen por qué verlo). */
export function limpiarMarcador(texto: string): string {
  return texto.replace(RE_MARCADOR, '').replace(/\s{2,}/g, ' ').trim()
}

/** Lee el código del texto de un mensaje entrante, si viene. */
export function leerMarcador(texto: string): string | null {
  const m = RE_MARCADOR.exec(texto || '')
  return m ? m[1].toUpperCase() : null
}

/**
 * Registra un clic de Ads y devuelve el código corto a incrustar en el link de
 * WhatsApp. Devuelve null si no hay nada que registrar o si falla.
 */
export async function registrarClick(d: {
  gclid?: string | null
  gbraid?: string | null
  wbraid?: string | null
  landing?: string | null
}): Promise<string | null> {
  if (!d.gclid && !d.gbraid && !d.wbraid) return null
  try {
    const sb = getSupabase()
    // Reintentos por si el código sorteado ya existía (colisión del índice único).
    for (let intento = 0; intento < 4; intento++) {
      const codigo = nuevoCodigo()
      const { error } = await sb.from(TABLA).insert({
        codigo,
        gclid: d.gclid || null,
        gbraid: d.gbraid || null,
        wbraid: d.wbraid || null,
        landing: (d.landing || '').slice(0, 300) || null,
      })
      if (!error) return codigo
      const msg = String(error.message || '').toLowerCase()
      if (!msg.includes('duplicate') && !msg.includes('unique')) throw new Error(error.message)
    }
    return null
  } catch (e) {
    console.warn('[ads-clicks] registrarClick:', e instanceof Error ? e.message : e)
    return null
  }
}

/**
 * El visitante escribió por WhatsApp con el código: le pegamos su teléfono.
 * No pisa un teléfono ya asignado (el mismo código reenviado por otra persona
 * no debe robarle la atribución al primero).
 */
export async function vincularTelefono(codigo: string, telefono: string): Promise<void> {
  const t = tel9(telefono)
  if (!codigo || t.length !== 9) return
  try {
    const sb = getSupabase()
    await sb.from(TABLA).update({ telefono: t })
      .eq('codigo', codigo.toUpperCase())
      .is('telefono', null)
  } catch (e) {
    console.warn('[ads-clicks] vincularTelefono:', e instanceof Error ? e.message : e)
  }
}

/**
 * Ese teléfono terminó en una ficha: se marca el clic MÁS RECIENTE de ese número
 * que todavía no tenga ficha. Best-effort; devuelve true si vinculó algo.
 *
 * Se toma el más reciente porque un tutor puede haber hecho clic varias veces
 * antes de escribir, y la última interacción es la que Google atribuye.
 */
export async function vincularClientePorTelefono(telefono: string, clienteId: string | number): Promise<boolean> {
  const t = tel9(telefono)
  if (t.length !== 9 || !clienteId) return false
  try {
    const sb = getSupabase()
    const { data, error } = await sb.from(TABLA)
      .select('id')
      .eq('telefono', t)
      .is('cliente_id', null)
      .order('created_at', { ascending: false })
      .limit(1)
    if (error || !data?.length) return false
    const { error: e2 } = await sb.from(TABLA)
      .update({ cliente_id: String(clienteId), vinculado_at: new Date().toISOString() })
      .eq('id', (data[0] as { id: number }).id)
    return !e2
  } catch (e) {
    console.warn('[ads-clicks] vincularClientePorTelefono:', e instanceof Error ? e.message : e)
    return false
  }
}

/** Clics con ficha asociada que todavía no se informaron a Google Ads. */
export async function pendientesDeSubir(limite = 200): Promise<AdsClick[]> {
  try {
    const sb = getSupabase()
    const { data, error } = await sb.from(TABLA)
      .select('*')
      .not('cliente_id', 'is', null)
      .is('subido_at', null)
      .order('created_at', { ascending: true })
      .limit(limite)
    if (error) throw new Error(error.message)
    return (data ?? []) as AdsClick[]
  } catch (e) {
    console.warn('[ads-clicks] pendientesDeSubir:', e instanceof Error ? e.message : e)
    return []
  }
}

export async function marcarSubidos(ids: number[]): Promise<void> {
  if (!ids.length) return
  try {
    const sb = getSupabase()
    await sb.from(TABLA).update({ subido_at: new Date().toISOString() }).in('id', ids)
  } catch (e) {
    console.warn('[ads-clicks] marcarSubidos:', e instanceof Error ? e.message : e)
  }
}

/** Resumen para el informe semanal: cuántos clics medidos y cuántos cerraron ficha. */
export async function resumenAtribucion(desdeIso: string): Promise<{ clics: number; conTelefono: number; conFicha: number } | null> {
  try {
    const sb = getSupabase()
    const desde = () => sb.from(TABLA).select('id', { count: 'exact', head: true }).gte('created_at', desdeIso)
    const [todos, conTel, conFicha] = await Promise.all([
      desde(),
      desde().not('telefono', 'is', null),
      desde().not('cliente_id', 'is', null),
    ])
    return {
      clics: todos.count ?? 0,
      conTelefono: conTel.count ?? 0,
      conFicha: conFicha.count ?? 0,
    }
  } catch {
    return null
  }
}
