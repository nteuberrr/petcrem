import { leerPerfilFacebook, getPageToken } from './meta-publish'

/**
 * Reportería de Meta para el agente de marketing y el dashboard:
 *   - resumenAds(): métricas de las CAMPAÑAS PAGADAS de Meta Ads (gasto, alcance,
 *     CPC, CPM, CTR, resultados) a nivel cuenta y por campaña.
 *   - resumenOrganico(): seguidores + rendimiento de los últimos posts de la Página.
 *
 * Lecturas de la Graph API (no cuestan). El token (System User) ya tiene ads_read /
 * read_insights. La cuenta publicitaria se toma de META_AD_ACCOUNT_ID, o se descubre
 * vía META_BUSINESS_ID (owned_ad_accounts) / /me/adaccounts.
 */

const API = process.env.META_API_VERSION || process.env.WHATSAPP_API_VERSION || 'v22.0'
const BASE = `https://graph.facebook.com/${API}`
function token(): string { return process.env.META_GRAPH_TOKEN || process.env.WHATSAPP_TOKEN || '' }
function pageId(): string { return process.env.META_PAGE_ID || '' }

export function isInsightsConfigurado(): boolean { return !!token() }

function num(v: unknown): number { const n = parseFloat(String(v ?? '')); return Number.isFinite(n) ? n : 0 }

async function graphGet(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(`${BASE}/${path}?${qs}`)
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) {
    const e = data?.error as { message?: string; code?: number } | undefined
    throw new Error(e?.message || `HTTP ${res.status}`)
  }
  return data
}

// ─── Cuenta publicitaria ──────────────────────────────────────────────────────
let adAccountCache: string | null = null
export async function getAdAccountId(): Promise<string> {
  if (adAccountCache) return adAccountCache
  const env = process.env.META_AD_ACCOUNT_ID
  if (env) { adAccountCache = env.startsWith('act_') ? env : `act_${env}`; return adAccountCache }
  const biz = process.env.META_BUSINESS_ID
  const pick = (arr: Array<{ id?: string; account_status?: number }>) =>
    (arr.find(a => a.account_status === 1) || arr[0])?.id || ''
  if (biz) {
    const d = await graphGet(`${biz}/owned_ad_accounts`, { fields: 'id,account_status', access_token: token() })
    const id = pick((d.data as Array<{ id?: string; account_status?: number }>) || [])
    if (id) { adAccountCache = id; return id }
  }
  const d2 = await graphGet('me/adaccounts', { fields: 'id,account_status', access_token: token() })
  const id2 = pick((d2.data as Array<{ id?: string; account_status?: number }>) || [])
  if (!id2) throw new Error('No se encontró una cuenta publicitaria. Configurá META_AD_ACCOUNT_ID.')
  adAccountCache = id2
  return id2
}

// ─── Ads (pagado) ─────────────────────────────────────────────────────────────
export interface MetricaCampana {
  nombre: string
  spend: number
  impresiones: number
  alcance: number
  clicks: number
  ctr: number
  cpc: number
  acciones: Array<{ tipo: string; valor: number }>
}
export interface ResumenAds {
  moneda: string
  periodo: string
  cuenta: Omit<MetricaCampana, 'nombre'>
  campanas: MetricaCampana[]
}

/** Resume las acciones (resultados) más relevantes de una fila de insights. */
function accionesDe(row: Record<string, unknown>): Array<{ tipo: string; valor: number }> {
  const actions = (row.actions as Array<{ action_type?: string; value?: string }>) || []
  return actions
    .map(a => ({ tipo: String(a.action_type || ''), valor: num(a.value) }))
    .filter(a => a.tipo && a.valor > 0)
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 6)
}
function metricaDe(row: Record<string, unknown>, nombre: string): MetricaCampana {
  return {
    nombre,
    spend: num(row.spend), impresiones: num(row.impressions), alcance: num(row.reach),
    clicks: num(row.clicks), ctr: num(row.ctr), cpc: num(row.cpc),
    acciones: accionesDe(row),
  }
}

export async function resumenAds(opts: { datePreset?: string } = {}): Promise<ResumenAds> {
  const act = await getAdAccountId()
  const datePreset = opts.datePreset || 'last_30d'
  const fields = 'spend,impressions,reach,clicks,ctr,cpc,cpm,actions'
  const [accData, campData, accInfo] = await Promise.all([
    graphGet(`${act}/insights`, { fields, date_preset: datePreset, level: 'account', access_token: token() }),
    graphGet(`${act}/insights`, { fields: `campaign_name,${fields}`, date_preset: datePreset, level: 'campaign', limit: '25', access_token: token() }),
    graphGet(act, { fields: 'currency', access_token: token() }).catch(() => ({ currency: 'CLP' })),
  ])
  const accRow = ((accData.data as Array<Record<string, unknown>>) || [])[0] || {}
  const campRows = (campData.data as Array<Record<string, unknown>>) || []
  return {
    moneda: String((accInfo as { currency?: string }).currency || 'CLP'),
    periodo: datePreset,
    cuenta: metricaDe(accRow, ''),
    campanas: campRows
      .map(c => metricaDe(c, String(c.campaign_name || 'Campaña')))
      .sort((a, b) => b.spend - a.spend),
  }
}

// ─── Orgánico (posts de la Página) ────────────────────────────────────────────
export interface PostOrganico {
  fecha: string
  mensaje: string
  impresiones: number
  reacciones: number
  comentarios: number
  compartidos: number
  url: string
}
export interface ResumenOrganico {
  seguidores: number
  posts: PostOrganico[]
}

export async function resumenOrganico(): Promise<ResumenOrganico> {
  const perfil = await leerPerfilFacebook().catch(() => null) as Record<string, unknown> | null
  const seguidores = num(perfil?.followers_count ?? perfil?.fan_count)
  let posts: PostOrganico[] = []
  try {
    const pt = await getPageToken()
    const d = await graphGet(`${pageId()}/posts`, {
      fields: 'created_time,message,permalink_url,shares,reactions.summary(true),comments.summary(true),insights.metric(post_impressions)',
      limit: '10',
      access_token: pt,
    })
    const rows = (d.data as Array<Record<string, unknown>>) || []
    posts = rows.map(p => {
      const reacciones = num((p.reactions as { summary?: { total_count?: number } })?.summary?.total_count)
      const comentarios = num((p.comments as { summary?: { total_count?: number } })?.summary?.total_count)
      const compartidos = num((p.shares as { count?: number })?.count)
      const ins = (p.insights as { data?: Array<{ values?: Array<{ value?: number }> }> })?.data?.[0]?.values?.[0]?.value
      return {
        fecha: String(p.created_time || ''),
        mensaje: String(p.message || '').slice(0, 120),
        impresiones: num(ins),
        reacciones, comentarios, compartidos,
        url: String(p.permalink_url || ''),
      }
    })
  } catch { /* posts/insights best-effort: si falla, devolvemos al menos seguidores */ }
  return { seguidores, posts }
}

/**
 * Interacciones (reacciones + comentarios + compartidos) por post publicado, para
 * destacar en el calendario las piezas que rindieron bien. Recibe los
 * post_externo_id (FB) y devuelve { id: interacciones } (best-effort).
 */
export async function performancePosts(postIds: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  const ids = [...new Set(postIds.filter(Boolean))].slice(0, 50)
  if (ids.length === 0) return out
  try {
    const pt = await getPageToken()
    const d = await graphGet('', { ids: ids.join(','), fields: 'shares,reactions.summary(true),comments.summary(true)', access_token: pt })
    for (const [id, v] of Object.entries(d)) {
      const p = v as Record<string, unknown>
      const reac = num((p.reactions as { summary?: { total_count?: number } })?.summary?.total_count)
      const com = num((p.comments as { summary?: { total_count?: number } })?.summary?.total_count)
      const sh = num((p.shares as { count?: number })?.count)
      out[id] = reac + com + sh
    }
  } catch { /* best-effort: si falla, sin destacados */ }
  return out
}
