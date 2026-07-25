/**
 * Descarga el HISTÓRICO de Meta Ads (cuenta propia) para armar gráficos evolutivos.
 *
 *   npx tsx scripts/meta-historico.ts [--desde=YYYY-MM-DD] [--out=ruta.json]
 *
 * Trae, con la Graph API (lecturas, no cuestan):
 *  - serie DIARIA a nivel cuenta: gasto, impresiones, alcance, clics, CTR, CPC, CPM,
 *    frecuencia y las acciones (resultados) de cada día;
 *  - serie MENSUAL por campaña (gasto + resultados), para ver qué empujó cada mes.
 *
 * Meta guarda insights ~37 meses; si se pide más, simplemente no devuelve filas.
 * Los pedidos se parten por AÑO para no chocar con los límites de la API.
 */
import './_env-preload'

const API = process.env.META_API_VERSION || 'v22.0'
const BASE = `https://graph.facebook.com/${API}`
const TOKEN = process.env.META_GRAPH_TOKEN || process.env.WHATSAPP_TOKEN || ''

function arg(nombre: string, def = ''): string {
  const m = process.argv.find(a => a.startsWith(`--${nombre}=`))
  return m ? m.split('=').slice(1).join('=') : def
}
function num(v: unknown): number { const n = parseFloat(String(v ?? '')); return Number.isFinite(n) ? n : 0 }

async function graphGet(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams({ ...params, access_token: TOKEN }).toString()
  const res = await fetch(`${BASE}/${path}?${qs}`)
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) {
    const e = data?.error as { message?: string; code?: number } | undefined
    throw new Error(`${e?.message || `HTTP ${res.status}`}${e?.code ? ` [code ${e.code}]` : ''}`)
  }
  return data
}

/** Sigue la paginación de la Graph API (hasta 50 páginas por las dudas). */
async function graphAll(path: string, params: Record<string, string>): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = []
  let d = await graphGet(path, params)
  for (let i = 0; i < 50; i++) {
    out.push(...((d.data as Array<Record<string, unknown>>) || []))
    const next = (d.paging as { next?: string })?.next
    if (!next) break
    const res = await fetch(next)
    d = await res.json() as Record<string, unknown>
    if (!res.ok) break
  }
  return out
}

async function adAccountId(): Promise<string> {
  const env = process.env.META_AD_ACCOUNT_ID || ''
  if (env) return env.startsWith('act_') ? env : `act_${env}`
  const biz = process.env.META_BUSINESS_ID
  if (biz) {
    const d = await graphGet(`${biz}/owned_ad_accounts`, { fields: 'id,account_status' })
    const arr = (d.data as Array<{ id?: string; account_status?: number }>) || []
    const id = (arr.find(a => a.account_status === 1) || arr[0])?.id
    if (id) return id
  }
  throw new Error('No hay META_AD_ACCOUNT_ID ni cuenta descubrible por META_BUSINESS_ID')
}

const FIELDS_DIA = 'spend,impressions,reach,frequency,clicks,inline_link_clicks,ctr,cpc,cpm,actions,action_values'

function tramosAnuales(desde: string, hasta: string): Array<{ since: string; until: string }> {
  const out: Array<{ since: string; until: string }> = []
  let ini = desde
  while (ini <= hasta) {
    const anio = Number(ini.slice(0, 4))
    const fin = `${anio}-12-31` < hasta ? `${anio}-12-31` : hasta
    out.push({ since: ini, until: fin })
    ini = `${anio + 1}-01-01`
  }
  return out
}

async function main() {
  if (!TOKEN) throw new Error('Falta META_GRAPH_TOKEN (o WHATSAPP_TOKEN) en .env.local')
  const act = await adAccountId()
  const info = await graphGet(act, { fields: 'name,currency,created_time,account_status,amount_spent' })
  const creada = String(info.created_time || '').slice(0, 10)
  const hoy = new Date().toISOString().slice(0, 10)
  const desde = arg('desde') || (creada && creada > '2000-01-01' ? creada : '2024-01-01')
  const tramos = tramosAnuales(desde, hoy)

  console.error(`Cuenta ${act} (${info.name}) · moneda ${info.currency} · creada ${creada}`)
  console.error(`Rango pedido: ${desde} → ${hoy} (${tramos.length} tramo/s)`)

  // 1) Serie diaria a nivel cuenta
  const dias: Array<Record<string, unknown>> = []
  for (const t of tramos) {
    const rows = await graphAll(`${act}/insights`, {
      level: 'account', fields: FIELDS_DIA, time_increment: '1',
      time_range: JSON.stringify(t), limit: '500',
    })
    console.error(`  · diario ${t.since}→${t.until}: ${rows.length} días`)
    dias.push(...rows)
  }

  // 2) Serie mensual por campaña
  const meses: Array<Record<string, unknown>> = []
  for (const t of tramos) {
    const rows = await graphAll(`${act}/insights`, {
      level: 'campaign', fields: `campaign_name,campaign_id,objective,${FIELDS_DIA}`,
      time_increment: 'monthly', time_range: JSON.stringify(t), limit: '500',
    })
    console.error(`  · campañas ${t.since}→${t.until}: ${rows.length} filas`)
    meses.push(...rows)
  }

  const norm = (r: Record<string, unknown>) => ({
    fecha: String(r.date_start || ''),
    hasta: String(r.date_stop || ''),
    campana: r.campaign_name ? String(r.campaign_name) : undefined,
    campana_id: r.campaign_id ? String(r.campaign_id) : undefined,
    objetivo: r.objective ? String(r.objective) : undefined,
    spend: num(r.spend), impresiones: num(r.impressions), alcance: num(r.reach),
    frecuencia: num(r.frequency), clicks: num(r.clicks), clicks_link: num(r.inline_link_clicks),
    ctr: num(r.ctr), cpc: num(r.cpc), cpm: num(r.cpm),
    acciones: ((r.actions as Array<{ action_type?: string; value?: string }>) || [])
      .map(a => ({ tipo: String(a.action_type || ''), valor: num(a.value) }))
      .filter(a => a.tipo && a.valor > 0),
  })

  const salida = {
    generado: new Date().toISOString(),
    cuenta: { id: act, nombre: String(info.name || ''), moneda: String(info.currency || 'CLP'), creada, gastado_total: num(info.amount_spent) },
    rango: { desde, hasta: hoy },
    diario: dias.map(norm).sort((a, b) => a.fecha.localeCompare(b.fecha)),
    campanas_mensual: meses.map(norm).sort((a, b) => a.fecha.localeCompare(b.fecha)),
  }
  const out = arg('out')
  if (out) {
    const fs = await import('node:fs/promises')
    await fs.writeFile(out, JSON.stringify(salida, null, 2), 'utf8')
    console.error(`\n✔ ${salida.diario.length} días y ${salida.campanas_mensual.length} filas de campaña → ${out}`)
  } else {
    process.stdout.write(JSON.stringify(salida, null, 2))
  }
}

main().catch(e => { console.error('ERROR:', e instanceof Error ? e.message : e); process.exit(1) })
