/**
 * Descarga el HISTÓRICO completo de Google Ads para armar gráficos evolutivos.
 *
 *   npx tsx scripts/google-ads-historico.ts [--desde=YYYY-MM-DD] [--out=ruta.json]
 *
 * Trae (GAQL, solo lecturas):
 *  - serie DIARIA de la cuenta: costo, impresiones, clics, conversiones, valor;
 *  - serie MENSUAL por campaña;
 *  - keywords y términos de búsqueda del período completo;
 *  - impression share por campaña (lo perdido por presupuesto vs por ranking);
 *  - conversiones por acción de conversión y por dispositivo.
 *
 * Sin --desde arranca en la primera fecha con datos de la cuenta.
 */
import './_env-preload'

const API_VERSION = process.env.GOOGLE_ADS_API_VERSION || 'v23'
const BASE = `https://googleads.googleapis.com/${API_VERSION}`

function arg(nombre: string, def = ''): string {
  const m = process.argv.find(a => a.startsWith(`--${nombre}=`))
  return m ? m.split('=').slice(1).join('=') : def
}
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const clp = (micros: unknown): number => Math.round(num(micros) / 1_000_000)

let tok = ''
async function token(): Promise<string> {
  if (tok) return tok
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET || '',
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN || '',
      grant_type: 'refresh_token',
    }),
  })
  const j = await res.json() as { access_token?: string; error_description?: string; error?: string }
  if (!j.access_token) throw new Error(j.error_description || j.error || 'no se pudo renovar el token')
  tok = j.access_token
  return tok
}

type Row = Record<string, Record<string, unknown>>
async function gaql(query: string): Promise<Row[]> {
  const t = await token()
  const cid = process.env.GOOGLE_ADS_CUSTOMER_ID || ''
  const res = await fetch(`${BASE}/customers/${cid}/googleAds:search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${t}`,
      'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
      'login-customer-id': process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || cid,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  })
  const j = await res.json() as { results?: Row[]; error?: { message?: string } }
  if (!res.ok) throw new Error(j.error?.message || `HTTP ${res.status}`)
  return j.results || []
}

async function main() {
  const hoy = new Date().toISOString().slice(0, 10)
  const cuenta = (await gaql('SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1'))[0]

  // Primera fecha con datos (si no la pasan por parámetro)
  let desde = arg('desde')
  if (!desde) {
    const r = await gaql(`SELECT segments.date FROM customer WHERE segments.date BETWEEN '2020-01-01' AND '${hoy}' ORDER BY segments.date ASC LIMIT 1`)
    desde = String(r[0]?.segments?.date || '2025-01-01')
  }
  const RANGO = `segments.date BETWEEN '${desde}' AND '${hoy}'`
  console.error(`Cuenta ${cuenta?.customer?.descriptiveName} (${cuenta?.customer?.id}) · ${cuenta?.customer?.currencyCode} · desde ${desde}`)

  const diarioRows = await gaql(`
    SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks,
           metrics.conversions, metrics.conversions_value, metrics.average_cpc, metrics.ctr
    FROM customer WHERE ${RANGO} ORDER BY segments.date ASC`)
  const diario = diarioRows.map(r => ({
    fecha: String(r.segments?.date || ''),
    costo: clp(r.metrics?.costMicros), impresiones: num(r.metrics?.impressions),
    clicks: num(r.metrics?.clicks), conversiones: num(r.metrics?.conversions),
    valor: num(r.metrics?.conversionsValue),
  }))
  console.error(`  · diario: ${diario.length} días`)

  const campRows = await gaql(`
    SELECT segments.month, campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
           metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
    FROM campaign WHERE ${RANGO} ORDER BY segments.month ASC`)
  const campanas = campRows.map(r => ({
    mes: String(r.segments?.month || ''), id: String(r.campaign?.id || ''),
    nombre: String(r.campaign?.name || ''), estado: String(r.campaign?.status || ''),
    canal: String(r.campaign?.advertisingChannelType || ''),
    costo: clp(r.metrics?.costMicros), impresiones: num(r.metrics?.impressions),
    clicks: num(r.metrics?.clicks), conversiones: num(r.metrics?.conversions),
  }))
  console.error(`  · campañas × mes: ${campanas.length} filas`)

  const kwRows = await gaql(`
    SELECT campaign.name, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
           ad_group_criterion.quality_info.quality_score, ad_group_criterion.status,
           metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
    FROM keyword_view WHERE ${RANGO} AND metrics.impressions > 0
    ORDER BY metrics.cost_micros DESC LIMIT 300`)
  const keywords = kwRows.map(r => ({
    campana: String(r.campaign?.name || ''), texto: String((r as any).adGroupCriterion?.keyword?.text || ''),
    match: String((r as any).adGroupCriterion?.keyword?.matchType || ''),
    qs: num((r as any).adGroupCriterion?.qualityInfo?.qualityScore) || null,
    estado: String((r as any).adGroupCriterion?.status || ''),
    costo: clp(r.metrics?.costMicros), impresiones: num(r.metrics?.impressions),
    clicks: num(r.metrics?.clicks), conversiones: num(r.metrics?.conversions),
  }))
  console.error(`  · keywords: ${keywords.length}`)

  const stRows = await gaql(`
    SELECT search_term_view.search_term, campaign.name, metrics.cost_micros,
           metrics.impressions, metrics.clicks, metrics.conversions
    FROM search_term_view WHERE ${RANGO} ORDER BY metrics.cost_micros DESC LIMIT 300`)
  const terminos = stRows.map(r => ({
    termino: String((r as any).searchTermView?.searchTerm || ''), campana: String(r.campaign?.name || ''),
    costo: clp(r.metrics?.costMicros), impresiones: num(r.metrics?.impressions),
    clicks: num(r.metrics?.clicks), conversiones: num(r.metrics?.conversions),
  }))
  console.error(`  · términos de búsqueda: ${terminos.length}`)

  const isRows = await gaql(`
    SELECT campaign.name, metrics.search_impression_share, metrics.search_budget_lost_impression_share,
           metrics.search_rank_lost_impression_share, metrics.impressions, metrics.cost_micros, metrics.conversions
    FROM campaign WHERE ${RANGO} AND metrics.impressions > 0`)
  const share = isRows.map(r => ({
    campana: String(r.campaign?.name || ''),
    is: num(r.metrics?.searchImpressionShare), perdido_presupuesto: num(r.metrics?.searchBudgetLostImpressionShare),
    perdido_ranking: num(r.metrics?.searchRankLostImpressionShare),
    impresiones: num(r.metrics?.impressions), costo: clp(r.metrics?.costMicros), conversiones: num(r.metrics?.conversions),
  }))

  const convRows = await gaql(`
    SELECT segments.conversion_action_name, metrics.all_conversions, metrics.conversions
    FROM customer WHERE ${RANGO}`)
  const conversiones = convRows.map(r => ({
    accion: String(r.segments?.conversionActionName || ''),
    conversiones: num(r.metrics?.conversions), todas: num(r.metrics?.allConversions),
  })).filter(c => c.accion)

  const devRows = await gaql(`
    SELECT segments.device, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
    FROM customer WHERE ${RANGO}`)
  const dispositivos = devRows.map(r => ({
    dispositivo: String(r.segments?.device || ''), costo: clp(r.metrics?.costMicros),
    impresiones: num(r.metrics?.impressions), clicks: num(r.metrics?.clicks), conversiones: num(r.metrics?.conversions),
  }))

  const horaRows = await gaql(`
    SELECT segments.hour, metrics.cost_micros, metrics.clicks, metrics.conversions
    FROM customer WHERE ${RANGO}`)
  const horas = horaRows.map(r => ({
    hora: num(r.segments?.hour), costo: clp(r.metrics?.costMicros),
    clicks: num(r.metrics?.clicks), conversiones: num(r.metrics?.conversions),
  })).sort((a, b) => a.hora - b.hora)

  const salida = {
    generado: new Date().toISOString(),
    cuenta: {
      id: String(cuenta?.customer?.id || ''), nombre: String(cuenta?.customer?.descriptiveName || ''),
      moneda: String(cuenta?.customer?.currencyCode || 'CLP'), zona: String(cuenta?.customer?.timeZone || ''),
    },
    rango: { desde, hasta: hoy },
    diario, campanas, keywords, terminos, share, conversiones, dispositivos, horas,
  }
  const out = arg('out')
  if (out) {
    const fs = await import('node:fs/promises')
    await fs.writeFile(out, JSON.stringify(salida, null, 2), 'utf8')
    console.error(`\n✔ histórico → ${out}`)
  } else process.stdout.write(JSON.stringify(salida, null, 2))
}

main().catch(e => { console.error('ERROR:', e instanceof Error ? e.message : e); process.exit(1) })
