/**
 * Lectura de Google Ads (campañas, keywords, términos de búsqueda) vía la REST
 * API de Google Ads (GAQL). Autenticación OAuth2 con refresh token (cuenta del
 * dueño) + developer token + login-customer-id (la MCC).
 *
 * Credenciales (.env.local):
 *   GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET   OAuth (Google Cloud, tipo Desktop)
 *   GOOGLE_ADS_REFRESH_TOKEN                          generado con scripts/google-ads-refresh-token.ts
 *   GOOGLE_ADS_DEVELOPER_TOKEN                         API Center de la MCC
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID                       la MCC (sin guiones)
 *   GOOGLE_ADS_CUSTOMER_ID                             cuenta operativa con las campañas (sin guiones)
 *   GOOGLE_ADS_API_VERSION                             default v23 (verificar developers.google.com/google-ads/api/docs/release-notes)
 *
 * Verificado en vivo 2026-07-07 contra la cuenta real (devolvió campañas reales,
 * confirma que el developer token tiene acceso Basic, no solo Test).
 */

const API_VERSION = process.env.GOOGLE_ADS_API_VERSION || 'v23'
const BASE = `https://googleads.googleapis.com/${API_VERSION}`

export function isGoogleAdsConfigurado(): boolean {
  return !!(
    process.env.GOOGLE_ADS_CLIENT_ID &&
    process.env.GOOGLE_ADS_CLIENT_SECRET &&
    process.env.GOOGLE_ADS_REFRESH_TOKEN &&
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
    process.env.GOOGLE_ADS_CUSTOMER_ID
  )
}

let tokenCache: { token: string; exp: number } | null = null

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.exp) return tokenCache.token
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET || '',
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN || '',
      grant_type: 'refresh_token',
    }),
  })
  const j = await res.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string; error_description?: string }
  if (!res.ok || !j.access_token) {
    // invalid_grant = el refresh token venció (app OAuth en modo "Prueba") → hay que
    // regenerarlo con scripts/google-ads-refresh-token.ts. Se marca para que el panel
    // muestre un banner claro en vez de un error genérico.
    if (j.error === 'invalid_grant') throw new Error('GOOGLE_ADS_TOKEN_VENCIDO')
    throw new Error(j.error_description || j.error || `No se pudo renovar el token de Google Ads (HTTP ${res.status})`)
  }
  tokenCache = { token: j.access_token, exp: Date.now() + ((j.expires_in ?? 3600) - 60) * 1000 }
  return j.access_token
}

/** true si el error es por el refresh token de Google Ads vencido (invalid_grant). */
export function esTokenVencido(e: unknown): boolean {
  return e instanceof Error && e.message === 'GOOGLE_ADS_TOKEN_VENCIDO'
}

type GaqlRow = Record<string, Record<string, unknown> & { resourceName?: string }>

async function gaqlSearch(query: string): Promise<GaqlRow[]> {
  const token = await getAccessToken()
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID || ''
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || customerId
  const res = await fetch(`${BASE}/customers/${customerId}/googleAds:search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
      'login-customer-id': loginCustomerId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  })
  const json = await res.json().catch(() => ({})) as { results?: GaqlRow[]; error?: { message?: string; details?: unknown } }
  if (!res.ok) {
    console.error('[google-ads] GAQL error:', JSON.stringify(json.error || json))
    throw new Error(json.error?.message || `Google Ads API: HTTP ${res.status}`)
  }
  return json.results || []
}

/**
 * Mutación genérica (POST {resource}:mutate). `validateOnly` valida la operación
 * SIN aplicarla (dry-run real de la API) — se usa para probar sin tocar datos.
 * Devuelve los resourceName resultantes (vacío en validateOnly, Google no los emite
 * porque no llegó a crear nada) — se usa para encadenar creaciones (ej. lista
 * compartida → sus criterios → adjuntarla a campañas).
 */
async function gaqlMutate(resource: string, operations: unknown[], validateOnly = false): Promise<string[]> {
  const token = await getAccessToken()
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID || ''
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || customerId
  const res = await fetch(`${BASE}/customers/${customerId}/${resource}:mutate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
      'login-customer-id': loginCustomerId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ operations, validateOnly }),
  })
  const json = await res.json().catch(() => ({})) as { error?: { message?: string; details?: unknown }; results?: Array<{ resourceName?: string }> }
  if (!res.ok) {
    console.error('[google-ads] mutate error:', JSON.stringify(json.error || json))
    const detalle = json.error?.details as Array<{ errors?: Array<{ message?: string }> }> | undefined
    const msgDetalle = detalle?.[0]?.errors?.[0]?.message
    throw new Error(msgDetalle || json.error?.message || `Google Ads API: HTTP ${res.status}`)
  }
  return (json.results || []).map(r => r.resourceName || '').filter(Boolean)
}

/**
 * Mutación HETEROGÉNEA y ATÓMICA (POST googleAds:mutate): varias operaciones de
 * distintos recursos en UNA sola transacción — si una falla, no se aplica ninguna
 * (no quedan recursos huérfanos). Permite referenciar recursos creados en la misma
 * request con resource names TEMPORALES (enteros negativos, ej. campaignBudgets/-1).
 * Se usa para el wizard de campaña nueva (budget→campaign→criterios→adGroup→keyword→RSA).
 * `validateOnly` valida TODO el conjunto sin aplicar nada (dry-run real del wizard entero).
 */
async function gaqlMutateMulti(mutateOperations: unknown[], validateOnly = false): Promise<string[]> {
  const token = await getAccessToken()
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID || ''
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || customerId
  const res = await fetch(`${BASE}/customers/${customerId}/googleAds:mutate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
      'login-customer-id': loginCustomerId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mutateOperations, validateOnly }),
  })
  const json = await res.json().catch(() => ({})) as { error?: { message?: string; details?: unknown }; mutateOperationResponses?: Array<Record<string, { resourceName?: string }>> }
  if (!res.ok) {
    console.error('[google-ads] mutateMulti error:', JSON.stringify(json.error || json))
    const detalle = json.error?.details as Array<{ errors?: Array<{ message?: string }> }> | undefined
    const msgDetalle = detalle?.[0]?.errors?.[0]?.message
    throw new Error(msgDetalle || json.error?.message || `Google Ads API: HTTP ${res.status}`)
  }
  // Cada respuesta es { <recurso>Result: { resourceName } } — extraemos todos los resourceName.
  return (json.mutateOperationResponses || []).map(r => Object.values(r)[0]?.resourceName || '').filter(Boolean)
}

function customerRN(): string { return `customers/${process.env.GOOGLE_ADS_CUSTOMER_ID || ''}` }

// ─── Rango de fechas: mismos presets que usa el panel de Meta ────────────────
const DURING_MAP: Record<string, string> = {
  last_7d: 'LAST_7_DAYS',
  last_14d: 'LAST_14_DAYS',
  last_30d: 'LAST_30_DAYS',
  this_month: 'THIS_MONTH',
  last_month: 'LAST_MONTH',
}

function fmtFecha(d: Date): string { return d.toISOString().slice(0, 10) }

/** GAQL no tiene un literal LAST_90_DAYS: para ese preset (u otros no mapeados) usamos un rango explícito. */
function whereFecha(periodo: string): string {
  const during = DURING_MAP[periodo]
  if (during) return `segments.date DURING ${during}`
  const dias = periodo === 'last_90d' ? 90 : 30
  const hasta = new Date()
  const desde = new Date()
  desde.setDate(desde.getDate() - dias)
  return `segments.date BETWEEN '${fmtFecha(desde)}' AND '${fmtFecha(hasta)}'`
}

function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0 }
/** Google Ads expresa montos en MICROS (1.000.000 micros = 1 unidad de la moneda de la cuenta). */
function clp(micros: unknown): number { return Math.round(num(micros) / 1_000_000) }

let monedaCache: { ts: number; moneda: string } | null = null
async function monedaCuenta(): Promise<string> {
  if (monedaCache && Date.now() - monedaCache.ts < 3_600_000) return monedaCache.moneda
  try {
    const rows = await gaqlSearch('SELECT customer.currency_code FROM customer LIMIT 1')
    const moneda = String(rows[0]?.customer?.currencyCode || 'CLP')
    monedaCache = { ts: Date.now(), moneda }
    return moneda
  } catch { return 'CLP' }
}

export interface SemanaImprClicks { impresiones: number; clicks: number }

/**
 * Impresiones + clics agregados POR SEMANA (lunes–domingo) en un rango de fechas.
 * La clave del Map es la fecha del LUNES de cada semana (`segments.week` de Google,
 * que también arranca en lunes) → se alinea 1:1 con las semanas ISO del embudo.
 * Suma TODAS las campañas, incluidas pausadas/eliminadas: interesa el histórico de
 * la cuenta, no el estado actual. La usa lib/embudo-semanal.ts.
 */
export async function impresionesClicksPorSemana(desdeIso: string, hastaIso: string): Promise<Map<string, SemanaImprClicks>> {
  const rows = await gaqlSearch(`
    SELECT segments.week, metrics.impressions, metrics.clicks
    FROM campaign
    WHERE segments.date BETWEEN '${desdeIso}' AND '${hastaIso}' AND campaign.status != 'REMOVED'
  `)
  const map = new Map<string, SemanaImprClicks>()
  for (const r of rows) {
    const wk = String((r.segments as Record<string, unknown> | undefined)?.week || '')
    if (!wk) continue
    const cur = map.get(wk) || { impresiones: 0, clicks: 0 }
    const m = (r.metrics || {}) as Record<string, unknown>
    cur.impresiones += num(m.impressions)
    cur.clicks += num(m.clicks)
    map.set(wk, cur)
  }
  return map
}

// ─── Campañas ─────────────────────────────────────────────────────────────────
export interface CampanaGoogle {
  id: string
  nombre: string
  status: string
  gasto: number
  impresiones: number
  clicks: number
  ctr: number
  cpc: number
  conversiones: number
  /** Valor total de conversión del período (suma de conversions_value). */
  conversionesValor: number
  /** Costo por conversión (CPA) = gasto / conversiones. 0 si no hubo conversiones. */
  costoPorConversion: number
  /** Impression Share (0-100) y % perdido — null si la campaña no sirvió/no aplica. */
  impressionShare: number | null
  perdidoPorPresupuesto: number | null
  perdidoPorRanking: number | null
}
export interface ComparacionPeriodo {
  etiqueta: string
  gasto: number
  conversiones: number
  conversionesValor: number
  costoPorConversion: number
}
export interface ResumenGoogleAds {
  moneda: string
  cuenta: Omit<CampanaGoogle, 'id' | 'nombre' | 'status'>
  campanas: CampanaGoogle[]
  /** Totales del período inmediatamente anterior (misma duración) para comparar. */
  comparacion?: ComparacionPeriodo
}

const pctIS = (v: unknown): number | null => v == null ? null : Math.round(num(v) * 1000) / 10
const cpa = (gasto: number, conv: number): number => conv > 0 ? Math.round(gasto / conv) : 0

/** WHERE de fechas del período INMEDIATAMENTE ANTERIOR (misma duración), para comparar. */
function whereFechaAnterior(periodo: string): { where: string; etiqueta: string } | null {
  const diasMap: Record<string, number> = { last_7d: 7, last_14d: 14, last_30d: 30, last_90d: 90 }
  const dstr = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return fmtFecha(d) }
  if (periodo in diasMap) {
    const n = diasMap[periodo]
    // Actual (DURING LAST_N_DAYS) = [hoy-n, hoy-1]; anterior = [hoy-2n, hoy-n-1].
    return { where: `segments.date BETWEEN '${dstr(2 * n)}' AND '${dstr(n + 1)}'`, etiqueta: `${n} días previos` }
  }
  const hoy = new Date()
  if (periodo === 'this_month') {
    const first = fmtFecha(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1))
    const last = fmtFecha(new Date(hoy.getFullYear(), hoy.getMonth(), 0))
    return { where: `segments.date BETWEEN '${first}' AND '${last}'`, etiqueta: 'mes anterior' }
  }
  if (periodo === 'last_month') {
    const first = fmtFecha(new Date(hoy.getFullYear(), hoy.getMonth() - 2, 1))
    const last = fmtFecha(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 0))
    return { where: `segments.date BETWEEN '${first}' AND '${last}'`, etiqueta: 'mes previo' }
  }
  return null
}

async function totalesPeriodo(where: string): Promise<{ gasto: number; conversiones: number; conversionesValor: number }> {
  const rows = await gaqlSearch(`
    SELECT metrics.cost_micros, metrics.conversions, metrics.conversions_value
    FROM campaign WHERE ${where} AND campaign.status != 'REMOVED'
  `)
  let gasto = 0, conversiones = 0, conversionesValor = 0
  for (const r of rows) {
    const m = (r.metrics || {}) as Record<string, unknown>
    gasto += clp(m.costMicros)
    conversiones += num(m.conversions)
    conversionesValor += clp(m.conversionsValue)
  }
  return { gasto, conversiones: Math.round(conversiones * 10) / 10, conversionesValor }
}

export async function resumenCampanas(periodo: string): Promise<ResumenGoogleAds> {
  const where = whereFecha(periodo)
  const anterior = whereFechaAnterior(periodo)
  const [rows, moneda, comparacionTot] = await Promise.all([
    gaqlSearch(`
      SELECT campaign.id, campaign.name, campaign.status,
             metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc,
             metrics.conversions, metrics.conversions_value,
             metrics.search_impression_share, metrics.search_budget_lost_impression_share, metrics.search_rank_lost_impression_share
      FROM campaign
      WHERE ${where} AND campaign.status != 'REMOVED'
    `),
    monedaCuenta(),
    anterior ? totalesPeriodo(anterior.where) : Promise.resolve(null),
  ])

  const campanas: CampanaGoogle[] = rows.map(r => {
    const m = (r.metrics || {}) as Record<string, unknown>
    const gasto = clp(m.costMicros)
    const conversiones = Math.round(num(m.conversions) * 10) / 10
    return {
      id: String(r.campaign?.id || ''),
      nombre: String(r.campaign?.name || 'Campaña'),
      status: String(r.campaign?.status || ''),
      gasto,
      impresiones: num(m.impressions),
      clicks: num(m.clicks),
      ctr: num(m.ctr) * 100,
      cpc: clp(m.averageCpc),
      conversiones,
      conversionesValor: clp(m.conversionsValue),
      costoPorConversion: cpa(gasto, conversiones),
      impressionShare: pctIS(m.searchImpressionShare),
      perdidoPorPresupuesto: pctIS(m.searchBudgetLostImpressionShare),
      perdidoPorRanking: pctIS(m.searchRankLostImpressionShare),
    }
  }).sort((a, b) => b.gasto - a.gasto)

  const cuenta = campanas.reduce((acc, c) => ({
    gasto: acc.gasto + c.gasto,
    impresiones: acc.impresiones + c.impresiones,
    clicks: acc.clicks + c.clicks,
    ctr: 0, // se recalcula abajo
    cpc: 0,
    conversiones: Math.round((acc.conversiones + c.conversiones) * 10) / 10,
    conversionesValor: acc.conversionesValor + c.conversionesValor,
    costoPorConversion: 0,
    impressionShare: null as number | null,
    perdidoPorPresupuesto: null as number | null,
    perdidoPorRanking: null as number | null,
  }), { gasto: 0, impresiones: 0, clicks: 0, ctr: 0, cpc: 0, conversiones: 0, conversionesValor: 0, costoPorConversion: 0, impressionShare: null as number | null, perdidoPorPresupuesto: null as number | null, perdidoPorRanking: null as number | null })
  cuenta.ctr = cuenta.impresiones > 0 ? Math.round((cuenta.clicks / cuenta.impresiones) * 1000) / 10 : 0
  cuenta.cpc = cuenta.clicks > 0 ? Math.round(cuenta.gasto / cuenta.clicks) : 0
  cuenta.costoPorConversion = cpa(cuenta.gasto, cuenta.conversiones)

  const comparacion: ComparacionPeriodo | undefined = (anterior && comparacionTot) ? {
    etiqueta: anterior.etiqueta,
    gasto: comparacionTot.gasto,
    conversiones: comparacionTot.conversiones,
    conversionesValor: comparacionTot.conversionesValor,
    costoPorConversion: cpa(comparacionTot.gasto, comparacionTot.conversiones),
  } : undefined

  return { moneda, cuenta, campanas, comparacion }
}

export interface PuntoSerieGoogle { fecha: string; gasto: number; conversiones: number }
/** Serie DIARIA de gasto + conversiones del período (para gráficos evolutivos). */
export async function serieDiariaGoogle(periodo = 'last_30d'): Promise<PuntoSerieGoogle[]> {
  const rows = await gaqlSearch(`
    SELECT segments.date, metrics.cost_micros, metrics.conversions
    FROM campaign
    WHERE ${whereFecha(periodo)} AND campaign.status != 'REMOVED'
  `)
  const porDia = new Map<string, { gasto: number; conversiones: number }>()
  for (const r of rows) {
    const fecha = String(r.segments?.date || '')
    if (!fecha) continue
    const m = (r.metrics || {}) as Record<string, unknown>
    const cur = porDia.get(fecha) || { gasto: 0, conversiones: 0 }
    cur.gasto += clp(m.costMicros)
    cur.conversiones += num(m.conversions)
    porDia.set(fecha, cur)
  }
  return [...porDia.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([fecha, v]) => ({ fecha, gasto: v.gasto, conversiones: Math.round(v.conversiones * 10) / 10 }))
}

// ─── Keywords ─────────────────────────────────────────────────────────────────
export interface KeywordGoogle {
  resourceName: string
  status: string
  texto: string
  matchType: string
  campana: string
  /** Estado de la CAMPAÑA dueña (ENABLED/PAUSED/REMOVED) — el status propio de la keyword
   *  puede ser ENABLED aunque la campaña o el grupo de anuncios estén pausados; en ese caso
   *  la keyword NO está gastando de verdad. Ver `enVivo`. */
  campanaEstado: string
  grupoAnuncioEstado: string
  /** true SOLO si la keyword está realmente sirviendo: ella, su grupo y su campaña ENABLED. */
  enVivo: boolean
  /** Quality Score 1-10 (null si Google todavía no tiene datos suficientes). */
  qualityScore: number | null
  gasto: number
  impresiones: number
  clicks: number
  ctr: number
  cpc: number
}

/** Por defecto trae ENABLED + PAUSED (para poder reactivar desde el panel). Incluye el
 *  estado de campaña/grupo porque el status propio de la keyword NO refleja si su campaña
 *  está pausada — sin esto, keywords de una campaña apagada se ven como "activas". */
export async function listarKeywords(periodo: string, limite = 30): Promise<{ moneda: string; keywords: KeywordGoogle[] }> {
  const where = whereFecha(periodo)
  const [rows, moneda] = await Promise.all([
    gaqlSearch(`
      SELECT ad_group_criterion.resource_name, ad_group_criterion.status,
             ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
             ad_group_criterion.quality_info.quality_score,
             campaign.name, campaign.status, ad_group.status,
             metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.ctr, metrics.average_cpc
      FROM keyword_view
      WHERE ${where} AND ad_group_criterion.status IN ('ENABLED', 'PAUSED')
        AND ad_group_criterion.negative = FALSE
    `),
    monedaCuenta(),
  ])
  const keywords: KeywordGoogle[] = rows.map(r => {
    const crit = (r.adGroupCriterion || {}) as Record<string, unknown>
    const kw = (crit.keyword || {}) as Record<string, unknown>
    const qi = (crit.qualityInfo || {}) as Record<string, unknown>
    const m = (r.metrics || {}) as Record<string, unknown>
    const status = String(crit.status || '')
    const campanaEstado = String(r.campaign?.status || '')
    const grupoAnuncioEstado = String(r.adGroup?.status || '')
    return {
      resourceName: String(crit.resourceName || ''),
      status,
      texto: String(kw.text || ''),
      matchType: String(kw.matchType || ''),
      campana: String(r.campaign?.name || ''),
      campanaEstado,
      grupoAnuncioEstado,
      enVivo: status === 'ENABLED' && campanaEstado === 'ENABLED' && grupoAnuncioEstado === 'ENABLED',
      qualityScore: qi.qualityScore != null ? num(qi.qualityScore) : null,
      gasto: clp(m.costMicros),
      impresiones: num(m.impressions),
      clicks: num(m.clicks),
      ctr: num(m.ctr) * 100,
      cpc: clp(m.averageCpc),
    }
  }).sort((a, b) => b.gasto - a.gasto).slice(0, limite)
  return { moneda, keywords }
}

export async function pausarKeywordGoogle(resourceName: string): Promise<void> {
  await gaqlMutate('adGroupCriteria', [{ update: { resourceName, status: 'PAUSED' }, updateMask: 'status' }])
}
export async function activarKeywordGoogle(resourceName: string): Promise<void> {
  await gaqlMutate('adGroupCriteria', [{ update: { resourceName, status: 'ENABLED' }, updateMask: 'status' }])
}

// ─── Términos de búsqueda (lo que la gente escribió de verdad en Google) ─────
export interface TerminoBusqueda {
  termino: string
  campana: string
  campanaId: string
  gasto: number
  impresiones: number
  clicks: number
  conversiones: number
}

export async function terminosBusqueda(periodo: string, limite = 30): Promise<{ moneda: string; terminos: TerminoBusqueda[] }> {
  const where = whereFecha(periodo)
  const [rows, moneda] = await Promise.all([
    gaqlSearch(`
      SELECT search_term_view.search_term, campaign.id, campaign.name,
             metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
      FROM search_term_view
      WHERE ${where}
    `),
    monedaCuenta(),
  ])
  const terminos: TerminoBusqueda[] = rows.map(r => {
    const stv = (r.searchTermView || {}) as Record<string, unknown>
    const m = (r.metrics || {}) as Record<string, unknown>
    return {
      termino: String(stv.searchTerm || ''),
      campana: String(r.campaign?.name || ''),
      campanaId: String(r.campaign?.id || ''),
      gasto: clp(m.costMicros),
      impresiones: num(m.impressions),
      clicks: num(m.clicks),
      conversiones: Math.round(num(m.conversions) * 10) / 10,
    }
  }).sort((a, b) => b.gasto - a.gasto).slice(0, limite)
  return { moneda, terminos }
}

/** Agrega el término como palabra clave NEGATIVA a nivel de campaña (bloquea que se vuelva a gastar en ella). */
export async function agregarNegativaCampana(
  campaignId: string,
  texto: string,
  matchType: 'EXACT' | 'PHRASE' | 'BROAD' = 'PHRASE',
): Promise<void> {
  if (!campaignId || !texto.trim()) throw new Error('Faltan datos para agregar la negativa.')
  await gaqlMutate('campaignCriteria', [{
    create: {
      campaign: `${customerRN()}/campaigns/${campaignId}`,
      negative: true,
      keyword: { text: texto.trim(), matchType },
    },
  }])
}

// ─── Gestión de campañas (pausar/activar/presupuesto) ─────────────────────────
export interface CampanaGestion {
  id: string
  nombre: string
  status: string
  presupuestoResourceName: string
  presupuestoClp: number
  /** true = el presupuesto es usado por MÁS de una campaña — editarlo acá afectaría a las demás. */
  compartido: boolean
}

export async function listarCampanasGestion(): Promise<{ moneda: string; campanas: CampanaGestion[] }> {
  const [rows, moneda] = await Promise.all([
    gaqlSearch(`
      SELECT campaign.id, campaign.name, campaign.status, campaign.campaign_budget,
             campaign_budget.amount_micros
      FROM campaign
      WHERE campaign.status IN ('ENABLED', 'PAUSED')
    `),
    monedaCuenta(),
  ])
  const porPresupuesto = new Map<string, number>()
  for (const r of rows) {
    const rn = String(r.campaign?.campaignBudget || '')
    porPresupuesto.set(rn, (porPresupuesto.get(rn) || 0) + 1)
  }
  const campanas: CampanaGestion[] = rows.map(r => {
    const rn = String(r.campaign?.campaignBudget || '')
    const budget = (r.campaignBudget || {}) as Record<string, unknown>
    return {
      id: String(r.campaign?.id || ''),
      nombre: String(r.campaign?.name || 'Campaña'),
      status: String(r.campaign?.status || ''),
      presupuestoResourceName: rn,
      presupuestoClp: clp(budget.amountMicros),
      compartido: (porPresupuesto.get(rn) || 0) > 1,
    }
  }).sort((a, b) => a.nombre.localeCompare(b.nombre))
  return { moneda, campanas }
}

async function setStatusCampana(campaignId: string, status: 'ENABLED' | 'PAUSED'): Promise<void> {
  await gaqlMutate('campaigns', [{
    update: { resourceName: `${customerRN()}/campaigns/${campaignId}`, status },
    updateMask: 'status',
  }])
}
export async function pausarCampanaGoogle(campaignId: string): Promise<void> { await setStatusCampana(campaignId, 'PAUSED') }
export async function activarCampanaGoogle(campaignId: string): Promise<void> { await setStatusCampana(campaignId, 'ENABLED') }

/** Ajusta el presupuesto DIARIO de una campaña (monto en CLP). Bloquea presupuestos compartidos. */
export async function ajustarPresupuestoGoogle(campaignId: string, montoClp: number): Promise<void> {
  if (!(montoClp > 0)) throw new Error('El presupuesto debe ser mayor a 0.')
  const { campanas } = await listarCampanasGestion()
  const c = campanas.find(x => x.id === campaignId)
  if (!c) throw new Error('Campaña no encontrada.')
  if (!c.presupuestoResourceName) throw new Error('No se encontró el presupuesto de esta campaña.')
  if (c.compartido) throw new Error('Esta campaña usa un presupuesto COMPARTIDO con otras campañas — cambiarlo acá afectaría a las demás. Editalo desde Google Ads directamente.')
  await gaqlMutate('campaignBudgets', [{
    update: { resourceName: c.presupuestoResourceName, amountMicros: String(Math.round(montoClp * 1_000_000)) },
    updateMask: 'amount_micros',
  }])
}

// ─── Quality Score + Impression Share (Fase A: lecturas para el agente + auditoría) ──
export interface KeywordConQS extends KeywordGoogle {
  campanaId: string
  qualityScore: number | null
}

/** Igual que listarKeywords pero agrega Quality Score y el id de campaña (para pausar/negativar por campaña).
 *  Solo trae keywords con status propio ENABLED, pero igual expone campanaEstado/enVivo porque su
 *  campaña o grupo de anuncios pueden estar pausados sin que el status propio lo refleje. */
export async function listarKeywordsConQS(periodo: string, limite = 200): Promise<{ moneda: string; keywords: KeywordConQS[] }> {
  const where = whereFecha(periodo)
  const [rows, moneda] = await Promise.all([
    gaqlSearch(`
      SELECT ad_group_criterion.resource_name, ad_group_criterion.status,
             ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
             ad_group_criterion.quality_info.quality_score,
             campaign.id, campaign.name, campaign.status, ad_group.status,
             metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.ctr, metrics.average_cpc
      FROM keyword_view
      WHERE ${where} AND ad_group_criterion.status = 'ENABLED'
        AND ad_group_criterion.negative = FALSE
    `),
    monedaCuenta(),
  ])
  const keywords: KeywordConQS[] = rows.map(r => {
    const crit = (r.adGroupCriterion || {}) as Record<string, unknown>
    const kw = (crit.keyword || {}) as Record<string, unknown>
    const qi = (crit.qualityInfo || {}) as Record<string, unknown>
    const m = (r.metrics || {}) as Record<string, unknown>
    const status = String(crit.status || '')
    const campanaEstado = String(r.campaign?.status || '')
    const grupoAnuncioEstado = String(r.adGroup?.status || '')
    return {
      resourceName: String(crit.resourceName || ''),
      status,
      texto: String(kw.text || ''),
      matchType: String(kw.matchType || ''),
      campana: String(r.campaign?.name || ''),
      campanaId: String(r.campaign?.id || ''),
      campanaEstado,
      grupoAnuncioEstado,
      enVivo: status === 'ENABLED' && campanaEstado === 'ENABLED' && grupoAnuncioEstado === 'ENABLED',
      qualityScore: qi.qualityScore != null ? num(qi.qualityScore) : null,
      gasto: clp(m.costMicros),
      impresiones: num(m.impressions),
      clicks: num(m.clicks),
      ctr: num(m.ctr) * 100,
      cpc: clp(m.averageCpc),
    }
  }).sort((a, b) => b.gasto - a.gasto).slice(0, limite)
  return { moneda, keywords }
}

export interface ImpressionShareCampana {
  id: string
  nombre: string
  gasto: number
  impressionShare: number | null
  perdidoPorPresupuesto: number | null
  perdidoPorRanking: number | null
}

/** Impression Share (30d por defecto) — cuánto % de las búsquedas elegibles se ganó, y por qué se pierde el resto. */
export async function impressionShareCampanas(periodo = 'last_30d'): Promise<ImpressionShareCampana[]> {
  const where = whereFecha(periodo)
  const rows = await gaqlSearch(`
    SELECT campaign.id, campaign.name, metrics.cost_micros,
           metrics.search_impression_share, metrics.search_budget_lost_impression_share,
           metrics.search_rank_lost_impression_share
    FROM campaign
    WHERE ${where} AND campaign.status = 'ENABLED'
  `)
  const pct = (v: unknown): number | null => v == null ? null : Math.round(num(v) * 1000) / 10
  return rows.map(r => {
    const m = (r.metrics || {}) as Record<string, unknown>
    return {
      id: String(r.campaign?.id || ''),
      nombre: String(r.campaign?.name || ''),
      gasto: clp(m.costMicros),
      impressionShare: pct(m.searchImpressionShare),
      perdidoPorPresupuesto: pct(m.searchBudgetLostImpressionShare),
      perdidoPorRanking: pct(m.searchRankLostImpressionShare),
    }
  })
}

export interface ConversionActionGoogle {
  resourceName: string
  nombre: string
  categoria: string
  tipo: string
  status: string
  primaryForGoal: boolean
  valorDefault: number | null
}

export async function listarConversionActions(): Promise<ConversionActionGoogle[]> {
  const rows = await gaqlSearch(`
    SELECT conversion_action.resource_name, conversion_action.name, conversion_action.category,
           conversion_action.type, conversion_action.status, conversion_action.primary_for_goal,
           conversion_action.value_settings.default_value
    FROM conversion_action
    WHERE conversion_action.status = 'ENABLED'
  `)
  return rows.map(r => {
    const c = (r.conversionAction || {}) as Record<string, unknown>
    const vs = (c.valueSettings || {}) as Record<string, unknown>
    return {
      resourceName: String(c.resourceName || ''),
      nombre: String(c.name || ''),
      categoria: String(c.category || ''),
      tipo: String(c.type || ''),
      status: String(c.status || ''),
      primaryForGoal: Boolean(c.primaryForGoal),
      valorDefault: vs.defaultValue != null ? num(vs.defaultValue) : null,
    }
  })
}

/** Cambia el valor por defecto de una conversion action (para corregir valores incoherentes — ver GUIA_GADS_BIDDING). */
export async function actualizarValorConversion(resourceName: string, valor: number, validateOnly = false): Promise<void> {
  if (!resourceName) throw new Error('Falta el resourceName de la conversion action.')
  if (!(valor > 0)) throw new Error('El valor debe ser mayor a 0.')
  await gaqlMutate('conversionActions', [{
    update: { resourceName, valueSettings: { defaultValue: valor } },
    updateMask: 'value_settings.default_value',
  }], validateOnly)
}

export interface AdGoogle {
  campana: string
  campanaId: string
  grupoAnuncio: string
  grupoAnuncioId: string
  status: string
  headlines: number
  headlinesPinned: number
  descripciones: number
  adStrength: string
  finalUrl: string
}

export async function listarAds(): Promise<AdGoogle[]> {
  const rows = await gaqlSearch(`
    SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_ad.status,
           ad_group_ad.ad.responsive_search_ad.headlines,
           ad_group_ad.ad.responsive_search_ad.descriptions,
           ad_group_ad.ad.final_urls, ad_group_ad.ad_strength
    FROM ad_group_ad
    WHERE ad_group_ad.status = 'ENABLED' AND campaign.status = 'ENABLED'
  `)
  return rows.map(r => {
    const adGroupAd = (r.adGroupAd || {}) as Record<string, unknown>
    const ad = (adGroupAd.ad || {}) as Record<string, unknown>
    const rsa = (ad.responsiveSearchAd || {}) as Record<string, unknown>
    const headlines = (rsa.headlines || []) as Array<{ pinnedField?: string }>
    const descripciones = (rsa.descriptions || []) as unknown[]
    const finalUrls = (ad.finalUrls || []) as string[]
    return {
      campana: String(r.campaign?.name || ''),
      campanaId: String(r.campaign?.id || ''),
      grupoAnuncio: String(r.adGroup?.name || ''),
      grupoAnuncioId: String(r.adGroup?.id || ''),
      status: String(adGroupAd.status || ''),
      headlines: headlines.length,
      headlinesPinned: headlines.filter(h => h.pinnedField).length,
      descripciones: descripciones.length,
      adStrength: String(adGroupAd.adStrength || 's/d'),
      finalUrl: finalUrls[0] || '',
    }
  })
}

// ─── Lecturas para la vigilancia diaria (lib/gads-vigilancia.ts) ────────────────
export interface AdConProblema {
  campana: string
  grupoAnuncio: string
  approvalStatus: string
  reviewStatus: string
}

/** Anuncios ACTIVOS cuya aprobación tiene problemas (rechazado o aprobado con límites).
 *  UNKNOWN/en revisión NO cuenta como problema (es el estado normal de un anuncio recién creado). */
export async function listarAdsConProblemas(): Promise<AdConProblema[]> {
  const rows = await gaqlSearch(`
    SELECT campaign.name, ad_group.name,
           ad_group_ad.policy_summary.approval_status, ad_group_ad.policy_summary.review_status
    FROM ad_group_ad
    WHERE ad_group_ad.status = 'ENABLED' AND campaign.status = 'ENABLED'
  `)
  const MALOS = new Set(['DISAPPROVED', 'AREA_OF_INTEREST_ONLY', 'APPROVED_LIMITED'])
  return rows
    .map(r => {
      const ps = ((r.adGroupAd || {}) as Record<string, unknown>).policySummary as Record<string, unknown> | undefined
      return {
        campana: String(r.campaign?.name || ''),
        grupoAnuncio: String(r.adGroup?.name || ''),
        approvalStatus: String(ps?.approvalStatus || ''),
        reviewStatus: String(ps?.reviewStatus || ''),
      }
    })
    .filter(a => MALOS.has(a.approvalStatus))
}

export interface GastoAyerCampana {
  nombre: string
  gasto: number
  presupuesto: number
}

/** Gasto de AYER por campaña activa, junto al presupuesto diario — para detectar campañas
 *  frenadas (gasto $0 con presupuesto asignado: pago rechazado, rechazo masivo de ads, etc.). */
export async function gastoDeAyerPorCampana(): Promise<GastoAyerCampana[]> {
  const rows = await gaqlSearch(`
    SELECT campaign.name, campaign_budget.amount_micros, metrics.cost_micros
    FROM campaign
    WHERE campaign.status = 'ENABLED' AND segments.date DURING YESTERDAY
  `)
  return rows.map(r => ({
    nombre: String(r.campaign?.name || ''),
    gasto: clp(((r.metrics || {}) as Record<string, unknown>).costMicros),
    presupuesto: clp(((r.campaignBudget || {}) as Record<string, unknown>).amountMicros),
  }))
}

/** Crea un RSA NUEVO (siempre PAUSED) en un grupo de anuncios existente — nunca reemplaza
 *  el anuncio actual, así el dueño revisa side-by-side en Google Ads antes de activar.
 *  headlines: exactamente 3 con pinnedSlot1=true (variantes de keyword) + 12 sin pinnear. */
export async function crearRSA(
  adGroupId: string,
  headlines: { texto: string; pinnedSlot1?: boolean }[],
  descriptions: string[],
  finalUrl: string,
  opts: { path1?: string; path2?: string; validateOnly?: boolean } = {},
): Promise<string> {
  if (!adGroupId) throw new Error('Falta el id del grupo de anuncios.')
  if (!finalUrl?.trim()) throw new Error('Falta la URL final.')
  const [rn] = await gaqlMutate('adGroupAds', [{
    create: {
      adGroup: `${customerRN()}/adGroups/${adGroupId}`,
      status: 'PAUSED',
      ad: {
        finalUrls: [finalUrl.trim()],
        responsiveSearchAd: {
          headlines: headlines.map(h => ({ text: h.texto.trim(), ...(h.pinnedSlot1 ? { pinnedField: 'HEADLINE_1' } : {}) })),
          descriptions: descriptions.map(d => ({ text: d.trim() })),
          ...(opts.path1 ? { path1: opts.path1.slice(0, 15) } : {}),
          ...(opts.path2 ? { path2: opts.path2.slice(0, 15) } : {}),
        },
      },
    },
  }], opts.validateOnly)
  return rn || ''
}

/** Elimina un anuncio (para deshacer una prueba, o retirar una versión vieja). */
export async function eliminarAd(adGroupAdResourceName: string): Promise<void> {
  if (!adGroupAdResourceName) throw new Error('Falta el resourceName del anuncio.')
  await gaqlMutate('adGroupAds', [{ remove: adGroupAdResourceName }])
}

/** Crea callouts NUEVOS a nivel campaña (los suma al pool, no reemplaza los existentes). */
export async function agregarCallouts(campaignId: string, textos: string[], validateOnly = false): Promise<number> {
  if (!campaignId) throw new Error('Falta el id de la campaña.')
  const limpios = textos.map(t => t.trim()).filter(Boolean)
  if (limpios.length === 0) throw new Error('No hay callouts para agregar.')
  const assetRNs = await gaqlMutate('assets', limpios.map(t => ({ create: { calloutAsset: { calloutText: t } } })), validateOnly)
  if (validateOnly) return limpios.length
  if (assetRNs.length === 0) throw new Error('Google Ads no devolvió los recursos creados.')
  await gaqlMutate('campaignAssets', assetRNs.map(rn => ({
    create: { campaign: `${customerRN()}/campaigns/${campaignId}`, asset: rn, fieldType: 'CALLOUT' },
  })))
  return assetRNs.length
}

export interface ConteoAssets { sitelinks: number; callouts: number; snippets: number }

export async function contarAssets(): Promise<ConteoAssets> {
  const rows = await gaqlSearch(`
    SELECT asset.type FROM asset WHERE asset.type IN ('SITELINK', 'CALLOUT', 'STRUCTURED_SNIPPET')
  `)
  const out: ConteoAssets = { sitelinks: 0, callouts: 0, snippets: 0 }
  for (const r of rows) {
    const t = String(r.asset?.type || '')
    if (t === 'SITELINK') out.sitelinks++
    else if (t === 'CALLOUT') out.callouts++
    else if (t === 'STRUCTURED_SNIPPET') out.snippets++
  }
  return out
}

export interface CampanaBidding {
  id: string
  nombre: string
  biddingStrategyType: string
  gasto: number
  conversiones: number
}

/** Estrategia de puja por campaña + conversiones del período — para chequear contra el playbook (GUIA_GADS_BIDDING). */
export async function campanasConBidding(periodo = 'last_30d'): Promise<CampanaBidding[]> {
  const where = whereFecha(periodo)
  const rows = await gaqlSearch(`
    SELECT campaign.id, campaign.name, campaign.bidding_strategy_type,
           metrics.cost_micros, metrics.conversions
    FROM campaign
    WHERE ${where} AND campaign.status = 'ENABLED'
  `)
  return rows.map(r => {
    const m = (r.metrics || {}) as Record<string, unknown>
    return {
      id: String(r.campaign?.id || ''),
      nombre: String(r.campaign?.name || ''),
      biddingStrategyType: String(r.campaign?.biddingStrategyType || ''),
      gasto: clp(m.costMicros),
      conversiones: Math.round(num(m.conversions) * 10) / 10,
    }
  })
}

export interface ConteoNegativas { campana: number; listasCompartidas: number }

export async function contarNegativas(): Promise<ConteoNegativas> {
  const [negs, lists] = await Promise.all([
    gaqlSearch(`SELECT campaign_criterion.criterion_id FROM campaign_criterion WHERE campaign_criterion.negative = TRUE AND campaign_criterion.type = 'KEYWORD'`),
    gaqlSearch(`SELECT shared_set.id FROM shared_set WHERE shared_set.status = 'ENABLED' AND shared_set.type = 'NEGATIVE_KEYWORDS'`),
  ])
  return { campana: negs.length, listasCompartidas: lists.length }
}

// ─── Listas de negativas compartidas (Fase C) ──────────────────────────────────
/** Textos (normalizados, minúscula+trim) ya negativados en la cuenta — a nivel campaña
 *  Y en listas compartidas existentes — para no duplicar al crear una lista nueva. */
function textoKeyword(criterio: unknown): string {
  const c = (criterio || {}) as Record<string, unknown>
  const kw = (c.keyword || {}) as Record<string, unknown>
  return String(kw.text || '').trim().toLowerCase()
}

async function textosNegativosExistentes(): Promise<Set<string>> {
  const [campaña, compartidas] = await Promise.all([
    gaqlSearch(`SELECT campaign_criterion.keyword.text FROM campaign_criterion WHERE campaign_criterion.negative = TRUE AND campaign_criterion.type = 'KEYWORD'`),
    gaqlSearch(`SELECT shared_criterion.keyword.text FROM shared_criterion WHERE shared_criterion.type = 'KEYWORD'`),
  ])
  const out = new Set<string>()
  for (const r of campaña) { const t = textoKeyword(r.campaignCriterion); if (t) out.add(t) }
  for (const r of compartidas) { const t = textoKeyword(r.sharedCriterion); if (t) out.add(t) }
  return out
}

export interface ListaNegativasCompartida {
  resourceName: string
  nombre: string
  cantidadTerminos: number
  campanas: string[]
}

export async function listarListasCompartidas(): Promise<ListaNegativasCompartida[]> {
  const [sets, campSets] = await Promise.all([
    gaqlSearch(`SELECT shared_set.resource_name, shared_set.name, shared_set.member_count FROM shared_set WHERE shared_set.status = 'ENABLED' AND shared_set.type = 'NEGATIVE_KEYWORDS'`),
    gaqlSearch(`SELECT campaign.name, campaign_shared_set.shared_set FROM campaign_shared_set WHERE campaign_shared_set.status = 'ENABLED'`),
  ])
  const campanasPorSet = new Map<string, string[]>()
  for (const r of campSets) {
    const rn = String((r.campaignSharedSet as Record<string, unknown> | undefined)?.sharedSet || '')
    if (!rn) continue
    const arr = campanasPorSet.get(rn) || []
    arr.push(String(r.campaign?.name || ''))
    campanasPorSet.set(rn, arr)
  }
  return sets.map(r => {
    const s = (r.sharedSet || {}) as Record<string, unknown>
    const rn = String(s.resourceName || '')
    return {
      resourceName: rn,
      nombre: String(s.name || ''),
      cantidadTerminos: num(s.memberCount),
      campanas: campanasPorSet.get(rn) || [],
    }
  })
}

/** Crea una lista de negativas COMPARTIDA (aplica a nivel cuenta, no a una campaña sola)
 *  con los términos dados, saltando los que ya existen (a nivel campaña o en otra lista
 *  compartida) para no duplicar. NO la adjunta a ninguna campaña — eso es un paso aparte
 *  (adjuntarListaATodasLasCampanas) para poder previsualizar antes de aplicarla. */
export async function crearListaNegativasCompartida(
  nombre: string,
  terminos: { texto: string; matchType?: 'EXACT' | 'PHRASE' | 'BROAD' }[],
  validateOnly = false,
): Promise<{ resourceName: string; agregados: number; duplicados: number }> {
  if (!nombre.trim()) throw new Error('Falta el nombre de la lista.')
  if (terminos.length === 0) throw new Error('No hay términos para agregar.')
  const existentes = validateOnly ? new Set<string>() : await textosNegativosExistentes()
  const nuevos = terminos.filter(t => !existentes.has(t.texto.trim().toLowerCase()))
  const duplicados = terminos.length - nuevos.length
  if (nuevos.length === 0) return { resourceName: '', agregados: 0, duplicados }

  const [setRn] = await gaqlMutate('sharedSets', [{ create: { name: nombre.trim(), type: 'NEGATIVE_KEYWORDS' } }], validateOnly)
  if (validateOnly) return { resourceName: '(validateOnly, no se creó nada)', agregados: nuevos.length, duplicados }
  if (!setRn) throw new Error('Google Ads no devolvió la lista creada.')

  // Lote de criterios (secuencial por lote, no todo en una sola llamada gigante si la lista crece).
  const LOTE = 200
  for (let i = 0; i < nuevos.length; i += LOTE) {
    const ops = nuevos.slice(i, i + LOTE).map(t => ({
      create: { sharedSet: setRn, keyword: { text: t.texto.trim(), matchType: t.matchType || 'BROAD' } },
    }))
    await gaqlMutate('sharedCriteria', ops)
  }
  return { resourceName: setRn, agregados: nuevos.length, duplicados }
}

/** Adjunta una lista compartida a TODAS las campañas activas/pausadas que todavía no la tengan. */
export async function adjuntarListaATodasLasCampanas(listaResourceName: string, validateOnly = false): Promise<{ adjuntadas: number; yaTenian: number }> {
  if (!listaResourceName) throw new Error('Falta el resourceName de la lista.')
  const [campanas, campSets] = await Promise.all([
    gaqlSearch(`SELECT campaign.resource_name FROM campaign WHERE campaign.status IN ('ENABLED', 'PAUSED')`),
    gaqlSearch(`SELECT campaign.resource_name, campaign_shared_set.shared_set FROM campaign_shared_set WHERE campaign_shared_set.status = 'ENABLED' AND campaign_shared_set.shared_set = '${listaResourceName}'`),
  ])
  const yaTienen = new Set(campSets.map(r => String(r.campaign?.resourceName || '')))
  const faltantes = campanas.map(r => String(r.campaign?.resourceName || '')).filter(rn => rn && !yaTienen.has(rn))
  if (faltantes.length === 0) return { adjuntadas: 0, yaTenian: campanas.length }
  await gaqlMutate('campaignSharedSets', faltantes.map(rn => ({ create: { campaign: rn, sharedSet: listaResourceName } })), validateOnly)
  return { adjuntadas: validateOnly ? 0 : faltantes.length, yaTenian: yaTienen.size }
}

export async function eliminarListaCompartida(resourceName: string): Promise<void> {
  if (!resourceName) throw new Error('Falta el resourceName de la lista.')
  await gaqlMutate('sharedSets', [{ remove: resourceName }])
}

// ─── Wizard de campaña nueva (Fase D parte 2) ──────────────────────────────────
/** Lee los geoTargetConstants (comunas/regiones) de una campaña existente, para copiar
 *  su cobertura geográfica a una campaña nueva sin hardcodear la lista de comunas. */
export async function leerGeoDeCampana(campaignId: string): Promise<string[]> {
  const rows = await gaqlSearch(`
    SELECT campaign_criterion.location.geo_target_constant
    FROM campaign_criterion
    WHERE campaign.id = ${JSON.stringify(campaignId)} AND campaign_criterion.type = 'LOCATION' AND campaign_criterion.negative = FALSE
  `)
  return rows.map(r => String(((r.campaignCriterion as Record<string, unknown> | undefined)?.location as Record<string, unknown> | undefined)?.geoTargetConstant || '')).filter(Boolean)
}

/** Campaña plantilla de geo por defecto: la de mayor gasto en 30 días (cobertura ya probada). */
async function campanaGeoPorDefecto(): Promise<string | null> {
  const rows = await gaqlSearch(`
    SELECT campaign.id, metrics.cost_micros FROM campaign
    WHERE segments.date DURING LAST_30_DAYS AND campaign.advertising_channel_type = 'SEARCH'
  `)
  let mejor: { id: string; gasto: number } | null = null
  for (const r of rows) {
    const id = String(r.campaign?.id || '')
    const gasto = num((r.metrics as Record<string, unknown> | undefined)?.costMicros)
    if (id && (!mejor || gasto > mejor.gasto)) mejor = { id, gasto }
  }
  return mejor?.id || null
}

// ─── Investigación de keywords (Keyword Planner) ───────────────────────────────
export interface IdeaKeyword {
  texto: string
  busquedasMensuales: number
  competencia: string
  competenciaIndex: number
  pujaBajaClp: number
  pujaAltaClp: number
}

/**
 * Genera ideas de keywords NUEVAS con datos reales de Google (Keyword Planner):
 * volumen de búsqueda mensual, competencia y rango de puja sugerida. A partir de
 * palabras semilla y/o una URL de referencia (se combinan si vienen ambas). Sin
 * geoTargetConstants explícitos, copia la cobertura de la campaña de mayor gasto
 * (misma lógica que crearCampanaCompleta) — así las ideas ya vienen acotadas a
 * donde el negocio realmente pauta, sin tener que pasarle comunas a mano.
 */
export async function generarIdeasKeywords(opts: {
  semillas?: string[]
  url?: string
  geoTargetConstants?: string[]
  limite?: number
}): Promise<{ ideas: IdeaKeyword[]; geoTargetConstants: string[] }> {
  const semillas = (opts.semillas || []).map(s => s.trim()).filter(Boolean).slice(0, 20)
  const url = opts.url?.trim()
  if (!semillas.length && !url) throw new Error('Necesito al menos una palabra semilla o una URL de referencia.')

  let geo = (opts.geoTargetConstants || []).filter(Boolean)
  if (!geo.length) {
    const campId = await campanaGeoPorDefecto()
    geo = campId ? await leerGeoDeCampana(campId) : []
  }
  if (!geo.length) throw new Error('No se pudo determinar la cobertura geográfica (no hay campañas activas con ubicaciones). Indicá geoTargetConstants manualmente.')

  const body: Record<string, unknown> = {
    language: 'languageConstants/1003',
    geoTargetConstants: geo,
    includeAdultKeywords: false,
    keywordPlanNetwork: 'GOOGLE_SEARCH',
  }
  if (url && semillas.length) body.keywordAndUrlSeed = { url, keywords: semillas }
  else if (url) body.urlSeed = { url }
  else body.keywordSeed = { keywords: semillas }

  const token = await getAccessToken()
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID || ''
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || customerId
  const res = await fetch(`${BASE}/customers/${customerId}:generateKeywordIdeas`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
      'login-customer-id': loginCustomerId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({})) as {
    results?: Array<{ text?: string; keywordIdeaMetrics?: Record<string, unknown> }>
    error?: { message?: string; details?: unknown }
  }
  if (!res.ok) {
    console.error('[google-ads] generateKeywordIdeas error:', JSON.stringify(json.error || json))
    const detalle = json.error?.details as Array<{ errors?: Array<{ message?: string }> }> | undefined
    throw new Error(detalle?.[0]?.errors?.[0]?.message || json.error?.message || `Google Ads API: HTTP ${res.status}`)
  }
  const limite = opts.limite && opts.limite > 0 ? Math.min(opts.limite, 200) : 40
  const ideas: IdeaKeyword[] = (json.results || [])
    .map(r => {
      const m = r.keywordIdeaMetrics || {}
      return {
        texto: String(r.text || ''),
        busquedasMensuales: num(m.avgMonthlySearches),
        competencia: String(m.competition || 'UNSPECIFIED'),
        competenciaIndex: num(m.competitionIndex),
        pujaBajaClp: clp(m.lowTopOfPageBidMicros),
        pujaAltaClp: clp(m.highTopOfPageBidMicros),
      }
    })
    .filter(k => k.texto)
    .sort((a, b) => b.busquedasMensuales - a.busquedasMensuales)
    .slice(0, limite)
  return { ideas, geoTargetConstants: geo }
}

export interface NuevaCampanaParams {
  nombreCampana: string
  presupuestoClpDiario: number
  keyword: string
  matchType?: 'EXACT' | 'PHRASE' | 'BROAD'
  finalUrl: string
  headlines: { texto: string; pinnedSlot1?: boolean }[]
  descriptions: string[]
  path1?: string
  path2?: string
  /** Campaña de la que copiar la cobertura geográfica. Si se omite, la de mayor gasto. */
  geoTemplateCampaignId?: string
  /** Negativas universales a cargar a nivel campaña (las pasa el caller para no acoplar guia). */
  negativas?: { texto: string; matchType?: 'EXACT' | 'PHRASE' | 'BROAD' }[]
}

/**
 * Crea una campaña de Búsqueda COMPLETA de una sola vez y ATÓMICAMENTE (si algo falla,
 * no queda nada a medias): presupuesto + campaña (Search-only, Maximize Conversions,
 * Presence, socios/display OFF) + geo (copiada de una campaña existente) + idioma español
 * + negativas a nivel campaña + grupo de anuncios + keyword (phrase) + 1 RSA. TODO en
 * estado PAUSED (salvo la keyword, que va ENABLED dentro del grupo pausado) para que el
 * dueño revise en Google Ads y active él. Devuelve el resourceName de la campaña creada.
 */
export async function crearCampanaCompleta(p: NuevaCampanaParams, validateOnly = false): Promise<{ campaignResourceName: string; geoComunas: number }> {
  if (!p.nombreCampana?.trim()) throw new Error('Falta el nombre de la campaña.')
  if (!(p.presupuestoClpDiario > 0)) throw new Error('El presupuesto diario debe ser mayor a 0.')
  if (!p.keyword?.trim()) throw new Error('Falta la keyword.')
  if (!p.finalUrl?.trim()) throw new Error('Falta la URL final.')

  const geoTemplate = p.geoTemplateCampaignId || await campanaGeoPorDefecto()
  const geo = geoTemplate ? await leerGeoDeCampana(geoTemplate) : []
  if (geo.length === 0) throw new Error('No se pudo determinar la cobertura geográfica (no hay campaña plantilla con ubicaciones). Indicá una campaña de la que copiar el geo.')

  const cust = customerRN()
  // Resource names TEMPORALES (negativos) para encadenar dentro de la misma transacción.
  const budgetTmp = `${cust}/campaignBudgets/-1`
  const campTmp = `${cust}/campaigns/-2`
  const adGroupTmp = `${cust}/adGroups/-3`

  const ops: unknown[] = []
  ops.push({ campaignBudgetOperation: { create: {
    resourceName: budgetTmp,
    name: `${p.nombreCampana.trim()} — presupuesto`,
    amountMicros: String(Math.round(p.presupuestoClpDiario * 1_000_000)),
    deliveryMethod: 'STANDARD',
    explicitlyShared: false,
  } } })
  ops.push({ campaignOperation: { create: {
    resourceName: campTmp,
    name: p.nombreCampana.trim(),
    advertisingChannelType: 'SEARCH',
    status: 'PAUSED',
    campaignBudget: budgetTmp,
    maximizeConversions: {},
    networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false, targetPartnerSearchNetwork: false },
    geoTargetTypeSetting: { positiveGeoTargetType: 'PRESENCE', negativeGeoTargetType: 'PRESENCE' },
    contains_eu_political_advertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
  } } })
  // Geo (copiado de la plantilla)
  for (const g of geo) ops.push({ campaignCriterionOperation: { create: { campaign: campTmp, location: { geoTargetConstant: g } } } })
  // Idioma español (languageConstants/1003)
  ops.push({ campaignCriterionOperation: { create: { campaign: campTmp, language: { languageConstant: 'languageConstants/1003' } } } })
  // Negativas a nivel campaña (si el caller las pasó)
  for (const n of (p.negativas || [])) ops.push({ campaignCriterionOperation: { create: { campaign: campTmp, negative: true, keyword: { text: n.texto.trim(), matchType: n.matchType || 'BROAD' } } } })
  // Grupo de anuncios (PAUSED)
  ops.push({ adGroupOperation: { create: { resourceName: adGroupTmp, name: p.keyword.trim(), campaign: campTmp, status: 'PAUSED' } } })
  // Keyword (phrase por defecto) — ENABLED dentro del grupo pausado
  ops.push({ adGroupCriterionOperation: { create: { adGroup: adGroupTmp, status: 'ENABLED', keyword: { text: p.keyword.trim(), matchType: p.matchType || 'PHRASE' } } } })
  // RSA (PAUSED)
  ops.push({ adGroupAdOperation: { create: {
    adGroup: adGroupTmp,
    status: 'PAUSED',
    ad: {
      finalUrls: [p.finalUrl.trim()],
      responsiveSearchAd: {
        headlines: p.headlines.map(h => ({ text: h.texto.trim(), ...(h.pinnedSlot1 ? { pinnedField: 'HEADLINE_1' } : {}) })),
        descriptions: p.descriptions.map(d => ({ text: d.trim() })),
        ...(p.path1 ? { path1: p.path1.slice(0, 15) } : {}),
        ...(p.path2 ? { path2: p.path2.slice(0, 15) } : {}),
      },
    },
  } } })

  const rns = await gaqlMutateMulti(ops, validateOnly)
  // La 2ª operación es la campaña; en validateOnly no vuelven resourceNames.
  const campaignResourceName = validateOnly ? '(validateOnly, no se creó nada)' : (rns.find(rn => rn.includes('/campaigns/')) || '')
  return { campaignResourceName, geoComunas: geo.length }
}
