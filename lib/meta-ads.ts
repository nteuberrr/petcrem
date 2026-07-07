/**
 * Gestión de campañas de Meta Ads — FASE 1: control seguro sobre campañas que YA
 * existen (pausar/activar y ajustar presupuesto). No crea campañas de cero.
 *
 * Escribe sobre la cuenta publicitaria PROPIA (act_…). El token de System User
 * (META_GRAPH_TOKEN) ya trae el scope `ads_management`, así que gestionar las
 * campañas propias NO requiere App Review de Meta.
 *
 * ⚠️ Unidad de presupuesto: Meta expresa los montos en la MENOR unidad de la
 * moneda de la cuenta. El CLP es una moneda SIN decimales → el valor de la API ES
 * el monto en pesos (factor 1). Calibrado en vivo contra la cuenta real
 * (min_daily_budget = 928 = $928 CLP; presupuestos de 5.463 / 9.561 = pesos).
 * Para monedas con centavos (USD, EUR, …) el factor es 100.
 */
import { getAdAccountId } from './meta-insights'

const API = process.env.META_API_VERSION || process.env.WHATSAPP_API_VERSION || 'v22.0'
const BASE = `https://graph.facebook.com/${API}`
function token(): string { return process.env.META_GRAPH_TOKEN || process.env.WHATSAPP_TOKEN || '' }

/** ¿Hay token para leer/gestionar Ads? (el scope ads_management ya viene en el System User). */
export function isAdsGestionConfigurado(): boolean { return !!token() }

// Monedas SIN decimales en Meta → factor 1. El resto usa centavos → factor 100.
const CERO_DECIMALES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
])
function factorMoneda(cur: string): number { return CERO_DECIMALES.has((cur || '').toUpperCase()) ? 1 : 100 }

async function graph(path: string, params: Record<string, string>, method: 'GET' | 'POST' = 'GET'): Promise<Record<string, unknown>> {
  const url = `${BASE}/${path}`
  let res: Response
  if (method === 'POST') {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) })
  } else {
    res = await fetch(`${url}?${new URLSearchParams(params).toString()}`)
  }
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) {
    // Meta devuelve error_user_msg legible (ej. "el presupuesto no puede ser menor
    // a lo ya gastado"); lo priorizamos para mostrarlo tal cual en la UI.
    const e = data?.error as { message?: string; code?: number; error_subcode?: number; error_user_msg?: string } | undefined
    const base = e?.error_user_msg || e?.message || `HTTP ${res.status}`
    const cod = e?.code != null ? ` [code ${e.code}${e.error_subcode != null ? '/' + e.error_subcode : ''}]` : ''
    console.error('[meta-ads] Graph error:', JSON.stringify(e || data))
    throw new Error(`${base}${cod}`)
  }
  return data
}

let monedaCache: string | null = null
async function moneda(): Promise<string> {
  if (monedaCache) return monedaCache
  const act = await getAdAccountId()
  const d = await graph(act, { fields: 'currency', access_token: token() }).catch(() => ({ currency: 'CLP' }))
  monedaCache = String((d as { currency?: string }).currency || 'CLP')
  return monedaCache
}

export type TipoPresupuesto = 'diario' | 'total' | 'adset' | 'ninguno'
export interface CampanaAds {
  id: string
  nombre: string
  status: string            // ACTIVE | PAUSED | ARCHIVED
  effective_status: string  // estado real (incl. IN_PROCESS, PENDING_REVIEW, WITH_ISSUES, DISAPPROVED…)
  objective: string
  /** dónde vive el presupuesto: 'diario'/'total' en la campaña · 'adset' (no editable acá) · 'ninguno' */
  tipo_presupuesto: TipoPresupuesto
  presupuesto_clp: number   // 0 si el presupuesto no está a nivel campaña
  moneda: string
}

/** Lista las campañas de la cuenta con su estado + presupuesto actual. */
export async function listarCampanas(): Promise<{ moneda: string; campanas: CampanaAds[] }> {
  const act = await getAdAccountId()
  const cur = await moneda()
  const f = factorMoneda(cur)
  const d = await graph(`${act}/campaigns`, {
    fields: 'name,status,effective_status,objective,daily_budget,lifetime_budget',
    limit: '100',
    access_token: token(),
  })
  const rows = (d.data as Array<Record<string, unknown>>) || []
  const campanas: CampanaAds[] = rows
    .filter(r => String(r.status) !== 'DELETED')
    .map(r => {
      const daily = parseFloat(String(r.daily_budget || '0')) || 0
      const life = parseFloat(String(r.lifetime_budget || '0')) || 0
      let tipo: TipoPresupuesto = 'ninguno'
      let monto = 0
      if (daily > 0) { tipo = 'diario'; monto = daily / f }
      else if (life > 0) { tipo = 'total'; monto = life / f }
      else tipo = 'adset' // sin presupuesto de campaña → normalmente vive en el ad set
      return {
        id: String(r.id || ''),
        nombre: String(r.name || 'Campaña'),
        status: String(r.status || ''),
        effective_status: String(r.effective_status || ''),
        objective: String(r.objective || ''),
        tipo_presupuesto: tipo,
        presupuesto_clp: Math.round(monto),
        moneda: cur,
      }
    })
  return { moneda: cur, campanas }
}

async function setStatus(id: string, status: 'ACTIVE' | 'PAUSED'): Promise<void> {
  await graph(id, { status, access_token: token() }, 'POST')
}
export async function pausarCampana(id: string): Promise<void> { await setStatus(id, 'PAUSED') }
export async function activarCampana(id: string): Promise<void> { await setStatus(id, 'ACTIVE') }

/**
 * Ajusta el presupuesto de una campaña. Detecta si es diario o total (leyendo la
 * campaña) y edita el campo que corresponde. Recibe el monto en CLP (pesos) y lo
 * convierte a la unidad de Meta según la moneda de la cuenta.
 */
export async function ajustarPresupuesto(id: string, montoClp: number): Promise<{ tipo: TipoPresupuesto; monto_clp: number }> {
  if (!(montoClp > 0)) throw new Error('El presupuesto debe ser mayor a 0.')
  const cur = await moneda()
  const f = factorMoneda(cur)
  const d = await graph(id, { fields: 'daily_budget,lifetime_budget', access_token: token() })
  const daily = parseFloat(String(d.daily_budget || '0')) || 0
  const life = parseFloat(String(d.lifetime_budget || '0')) || 0
  const raw = String(Math.round(montoClp * f))
  if (daily > 0) {
    await graph(id, { daily_budget: raw, access_token: token() }, 'POST')
    return { tipo: 'diario', monto_clp: montoClp }
  }
  if (life > 0) {
    await graph(id, { lifetime_budget: raw, access_token: token() }, 'POST')
    return { tipo: 'total', monto_clp: montoClp }
  }
  throw new Error('Esta campaña maneja el presupuesto a nivel de conjunto de anuncios (ad set), no de campaña. Editalo desde Meta Ads Manager.')
}
