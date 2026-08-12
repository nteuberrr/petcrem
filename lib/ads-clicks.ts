import { getSupabase } from './supabase'

/**
 * ATRIBUCIÓN DE ANUNCIOS — capa de datos de `ads_clicks`.
 *
 * Cierra el hueco entre el clic en el anuncio y la ficha real. El recorrido
 * completo está documentado en supabase/migracion-ads-clicks.sql; acá van las
 * operaciones que lo sostienen:
 *
 *   registrarClick()        la landing vio un gclid/fbclid → devuelve el código
 *   registrarClickCtwa()    llegó un WhatsApp desde un anuncio click-to-WhatsApp
 *   vincularTelefono()      llegó un WhatsApp con ese código
 *   vincularClientePorTelefono()  ese teléfono terminó en una ficha
 *   pendientesDeSubir()     fichas listas para informar a Google Ads
 *   pendientesMetaLead() / pendientesMetaCompra()   lo mismo, para Meta
 *   marcarSubidos() / marcarMetaLead() / marcarMetaCompra()  ya informadas
 *
 * DOS PLATAFORMAS, LA MISMA CAÑERÍA. Una fila puede traer un identificador de
 * Google (`gclid`/`gbraid`/`wbraid`), uno de Meta (`fbclid` desde la web,
 * `ctwa_clid` desde un anuncio click-to-WhatsApp) o los dos. Cada plataforma
 * tiene su propia marca de "ya informado", porque se suben por separado y una
 * no puede tapar a la otra.
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
  /** Identificador de clic de Meta (web). Se convierte en `fbc` al informar. */
  fbclid: string | null
  /** Identificador de clic de un anuncio click-to-WhatsApp (lo manda el webhook). */
  ctwa_clid: string | null
  landing: string | null
  telefono: string | null
  cliente_id: string | null
  vinculado_at: string | null
  subido_at: string | null
  /** Cuándo se informó el «Lead» a Meta (null = pendiente). */
  meta_lead_at: string | null
  /** Cuándo se informó la «Purchase» a Meta (null = pendiente). */
  meta_compra_at: string | null
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
  fbclid?: string | null
  landing?: string | null
}): Promise<string | null> {
  if (!d.gclid && !d.gbraid && !d.wbraid && !d.fbclid) return null
  try {
    const sb = getSupabase()
    // Si la columna `fbclid` todavía no existe (el DDL se corre a mano en
    // Supabase), PostgREST rechaza el insert ENTERO — y con él se caería también
    // la atribución de Google, que venía funcionando. Ante ese error puntual se
    // reintenta sin el campo: se pierde el clic de Meta, no los dos.
    let conFbclid = true
    // Reintentos por si el código sorteado ya existía (colisión del índice único).
    for (let intento = 0; intento < 5; intento++) {
      const codigo = nuevoCodigo()
      const { error } = await sb.from(TABLA).insert({
        codigo,
        gclid: d.gclid || null,
        gbraid: d.gbraid || null,
        wbraid: d.wbraid || null,
        ...(conFbclid ? { fbclid: d.fbclid || null } : {}),
        landing: (d.landing || '').slice(0, 300) || null,
      })
      if (!error) return codigo
      const msg = String(error.message || '').toLowerCase()
      if (conFbclid && msg.includes('fbclid')) {
        console.warn('[ads-clicks] falta la columna fbclid — corré supabase/atribucion-meta-y-seguimiento.sql')
        conFbclid = false
        continue
      }
      if (!msg.includes('duplicate') && !msg.includes('unique')) throw new Error(error.message)
    }
    return null
  } catch (e) {
    console.warn('[ads-clicks] registrarClick:', e instanceof Error ? e.message : e)
    return null
  }
}

/**
 * El cliente escribió por WhatsApp desde un anuncio click-to-WhatsApp: Meta
 * manda el `ctwa_clid` en el propio webhook, así que acá no hay código corto ni
 * paso por la web — el teléfono se conoce desde el minuto cero.
 *
 * Idempotente por `ctwa_clid`: Meta repite el bloque `referral` en TODOS los
 * mensajes de las primeras 24 h después del clic, y sin este chequeo cada
 * mensaje del cliente crearía una fila nueva y la conversión se informaría
 * varias veces.
 */
export async function registrarClickCtwa(ctwaClid: string, telefono: string): Promise<void> {
  const clid = (ctwaClid || '').trim().slice(0, 512)
  const t = tel9(telefono)
  if (!clid || t.length !== 9) return
  try {
    const sb = getSupabase()
    const { data } = await sb.from(TABLA).select('id').eq('ctwa_clid', clid).limit(1)
    if (data?.length) return
    for (let intento = 0; intento < 4; intento++) {
      const { error } = await sb.from(TABLA).insert({
        codigo: nuevoCodigo(), ctwa_clid: clid, telefono: t, landing: 'ctwa',
      })
      if (!error) return
      const msg = String(error.message || '').toLowerCase()
      if (!msg.includes('duplicate') && !msg.includes('unique')) throw new Error(error.message)
    }
  } catch (e) {
    console.warn('[ads-clicks] registrarClickCtwa:', e instanceof Error ? e.message : e)
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

/** Los identificadores de clic de cada plataforma, para filtrar en PostgREST. */
const HAY_ID_GOOGLE = 'gclid.not.is.null,gbraid.not.is.null,wbraid.not.is.null'
const HAY_ID_META = 'fbclid.not.is.null,ctwa_clid.not.is.null'

/**
 * Clics con ficha asociada que todavía no se informaron a Google Ads.
 *
 * Filtra por identificador de GOOGLE: desde que la tabla también guarda clics de
 * Meta, una fila con solo `fbclid` no tiene nada que Google pueda reconocer y la
 * API la rechazaría en cada corrida, para siempre.
 */
export async function pendientesDeSubir(limite = 200): Promise<AdsClick[]> {
  try {
    const sb = getSupabase()
    const { data, error } = await sb.from(TABLA)
      .select('*')
      .not('cliente_id', 'is', null)
      .is('subido_at', null)
      .or(HAY_ID_GOOGLE)
      .order('created_at', { ascending: true })
      .limit(limite)
    if (error) throw new Error(error.message)
    return (data ?? []) as AdsClick[]
  } catch (e) {
    console.warn('[ads-clicks] pendientesDeSubir:', e instanceof Error ? e.message : e)
    return []
  }
}

/**
 * Clics de Meta con TELÉFONO y sin «Lead» informado: la conversación empezó.
 *
 * Es el evento de optimización real de las campañas. Va sobre el teléfono y no
 * sobre la ficha a propósito: con ~46 fichas al mes, una campaña alimentada solo
 * con compras nunca junta la señal que Meta necesita para salir de aprendizaje.
 */
export async function pendientesMetaLead(limite = 200): Promise<AdsClick[]> {
  return pendientesMeta('meta_lead_at', 'telefono', limite)
}

/** Clics de Meta con FICHA y sin «Purchase» informada: se cerró la venta. */
export async function pendientesMetaCompra(limite = 200): Promise<AdsClick[]> {
  return pendientesMeta('meta_compra_at', 'cliente_id', limite)
}

async function pendientesMeta(marca: string, requiere: string, limite: number): Promise<AdsClick[]> {
  try {
    const sb = getSupabase()
    const { data, error } = await sb.from(TABLA)
      .select('*')
      .not(requiere, 'is', null)
      .is(marca, null)
      .or(HAY_ID_META)
      .order('created_at', { ascending: true })
      .limit(limite)
    if (error) throw new Error(error.message)
    return (data ?? []) as AdsClick[]
  } catch (e) {
    console.warn(`[ads-clicks] pendientesMeta(${marca}):`, e instanceof Error ? e.message : e)
    return []
  }
}

export async function marcarSubidos(ids: number[]): Promise<void> {
  await marcar('subido_at', ids)
}

export async function marcarMetaLead(ids: number[]): Promise<void> {
  await marcar('meta_lead_at', ids)
}

export async function marcarMetaCompra(ids: number[]): Promise<void> {
  await marcar('meta_compra_at', ids)
}

async function marcar(columna: string, ids: number[]): Promise<void> {
  if (!ids.length) return
  try {
    const sb = getSupabase()
    await sb.from(TABLA).update({ [columna]: new Date().toISOString() }).in('id', ids)
  } catch (e) {
    console.warn(`[ads-clicks] marcar(${columna}):`, e instanceof Error ? e.message : e)
  }
}

/**
 * Resumen para el informe semanal: cuántos clics medidos y cuántos cerraron ficha.
 *
 * Devuelve además `midiendoDesde`: la fecha del PRIMER clic registrado, que es
 * cuando esta medición empezó a existir. Sin ese dato el informe leía "5 fichas
 * en 14 días" como un embudo pésimo, cuando la atribución llevaba dos días viva
 * (se desplegó el 08-08-2026). Una métrica más nueva que su ventana no se juzga.
 */
export async function resumenAtribucion(desdeIso: string): Promise<{
  clics: number; conTelefono: number; conFicha: number; midiendoDesde: string | null
} | null> {
  try {
    const sb = getSupabase()
    const desde = () => sb.from(TABLA).select('id', { count: 'exact', head: true }).gte('created_at', desdeIso)
    const [todos, conTel, conFicha, primero] = await Promise.all([
      desde(),
      desde().not('telefono', 'is', null),
      desde().not('cliente_id', 'is', null),
      sb.from(TABLA).select('created_at').order('created_at', { ascending: true }).limit(1),
    ])
    return {
      clics: todos.count ?? 0,
      conTelefono: conTel.count ?? 0,
      conFicha: conFicha.count ?? 0,
      midiendoDesde: (primero.data?.[0] as { created_at?: string } | undefined)?.created_at?.slice(0, 10) ?? null,
    }
  } catch {
    return null
  }
}
