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
    throw new Error(j.error_description || j.error || `No se pudo renovar el token de Google Ads (HTTP ${res.status})`)
  }
  tokenCache = { token: j.access_token, exp: Date.now() + ((j.expires_in ?? 3600) - 60) * 1000 }
  return j.access_token
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
 */
async function gaqlMutate(resource: string, operations: unknown[], validateOnly = false): Promise<void> {
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
  const json = await res.json().catch(() => ({})) as { error?: { message?: string; details?: unknown } }
  if (!res.ok) {
    console.error('[google-ads] mutate error:', JSON.stringify(json.error || json))
    const detalle = json.error?.details as Array<{ errors?: Array<{ message?: string }> }> | undefined
    const msgDetalle = detalle?.[0]?.errors?.[0]?.message
    throw new Error(msgDetalle || json.error?.message || `Google Ads API: HTTP ${res.status}`)
  }
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
}
export interface ResumenGoogleAds {
  moneda: string
  cuenta: Omit<CampanaGoogle, 'id' | 'nombre' | 'status'>
  campanas: CampanaGoogle[]
}

export async function resumenCampanas(periodo: string): Promise<ResumenGoogleAds> {
  const where = whereFecha(periodo)
  const [rows, moneda] = await Promise.all([
    gaqlSearch(`
      SELECT campaign.id, campaign.name, campaign.status,
             metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc, metrics.conversions
      FROM campaign
      WHERE ${where}
    `),
    monedaCuenta(),
  ])

  const campanas: CampanaGoogle[] = rows.map(r => {
    const m = (r.metrics || {}) as Record<string, unknown>
    return {
      id: String(r.campaign?.id || ''),
      nombre: String(r.campaign?.name || 'Campaña'),
      status: String(r.campaign?.status || ''),
      gasto: clp(m.costMicros),
      impresiones: num(m.impressions),
      clicks: num(m.clicks),
      ctr: num(m.ctr) * 100,
      cpc: clp(m.averageCpc),
      conversiones: Math.round(num(m.conversions) * 10) / 10,
    }
  }).sort((a, b) => b.gasto - a.gasto)

  const cuenta = campanas.reduce((acc, c) => ({
    gasto: acc.gasto + c.gasto,
    impresiones: acc.impresiones + c.impresiones,
    clicks: acc.clicks + c.clicks,
    ctr: 0, // se recalcula abajo
    cpc: 0,
    conversiones: Math.round((acc.conversiones + c.conversiones) * 10) / 10,
  }), { gasto: 0, impresiones: 0, clicks: 0, ctr: 0, cpc: 0, conversiones: 0 })
  cuenta.ctr = cuenta.impresiones > 0 ? Math.round((cuenta.clicks / cuenta.impresiones) * 1000) / 10 : 0
  cuenta.cpc = cuenta.clicks > 0 ? Math.round(cuenta.gasto / cuenta.clicks) : 0

  return { moneda, cuenta, campanas }
}

// ─── Keywords ─────────────────────────────────────────────────────────────────
export interface KeywordGoogle {
  resourceName: string
  status: string
  texto: string
  matchType: string
  campana: string
  gasto: number
  impresiones: number
  clicks: number
  ctr: number
  cpc: number
}

/** Por defecto trae ENABLED + PAUSED (para poder reactivar desde el panel). */
export async function listarKeywords(periodo: string, limite = 30): Promise<{ moneda: string; keywords: KeywordGoogle[] }> {
  const where = whereFecha(periodo)
  const [rows, moneda] = await Promise.all([
    gaqlSearch(`
      SELECT ad_group_criterion.resource_name, ad_group_criterion.status,
             ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, campaign.name,
             metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.ctr, metrics.average_cpc
      FROM keyword_view
      WHERE ${where} AND ad_group_criterion.status IN ('ENABLED', 'PAUSED')
    `),
    monedaCuenta(),
  ])
  const keywords: KeywordGoogle[] = rows.map(r => {
    const crit = (r.adGroupCriterion || {}) as Record<string, unknown>
    const kw = (crit.keyword || {}) as Record<string, unknown>
    const m = (r.metrics || {}) as Record<string, unknown>
    return {
      resourceName: String(crit.resourceName || ''),
      status: String(crit.status || ''),
      texto: String(kw.text || ''),
      matchType: String(kw.matchType || ''),
      campana: String(r.campaign?.name || ''),
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
