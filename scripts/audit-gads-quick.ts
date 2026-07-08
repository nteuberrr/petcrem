import './_env-preload'

const BASE = `https://googleads.googleapis.com/${process.env.GOOGLE_ADS_API_VERSION || 'v23'}`
async function tok() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID!, client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN!, grant_type: 'refresh_token',
    }),
  })
  return (await r.json()).access_token
}
async function q(query: string, token: string) {
  const r = await fetch(`${BASE}/customers/${process.env.GOOGLE_ADS_CUSTOMER_ID}/googleAds:search`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN!, 'login-customer-id': process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const j = await r.json()
  if (!r.ok) { console.log('ERR:', JSON.stringify(j).slice(0, 300)); return [] }
  return j.results || []
}

async function main() {
  const t = await tok()

  console.log('=== 1. Config de campañas (los "9 defaults") ===')
  const camps = await q(`SELECT campaign.name, campaign.status, campaign.bidding_strategy_type,
    campaign.network_settings.target_search_network, campaign.network_settings.target_partner_search_network,
    campaign.network_settings.target_content_network, campaign.geo_target_type_setting.positive_geo_target_type
    FROM campaign WHERE campaign.status != 'REMOVED'`, t)
  for (const r of camps) {
    const c = r.campaign, ns = c.networkSettings || {}, g = c.geoTargetTypeSetting || {}
    console.log(`- ${c.name} [${c.status}] bidding=${c.biddingStrategyType} | searchPartners=${ns.targetPartnerSearchNetwork} display=${ns.targetContentNetwork} | geo=${g.positiveGeoTargetType}`)
  }

  console.log('\n=== 2. Conversion actions ===')
  const convs = await q(`SELECT conversion_action.name, conversion_action.category, conversion_action.status,
    conversion_action.type, conversion_action.primary_for_goal, conversion_action.value_settings.default_value
    FROM conversion_action WHERE conversion_action.status = 'ENABLED'`, t)
  for (const r of convs) {
    const c = r.conversionAction
    console.log(`- ${c.name} | cat=${c.category} tipo=${c.type} primary=${c.primaryForGoal} valor=${c.valueSettings?.defaultValue ?? '(sin valor)'}`)
  }

  console.log('\n=== 3. Ads (RSAs): headlines/descripciones por ad ===')
  const ads = await q(`SELECT campaign.name, ad_group.name, ad_group_ad.ad.responsive_search_ad.headlines,
    ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.ad.final_urls, ad_group_ad.ad_strength
    FROM ad_group_ad WHERE ad_group_ad.status = 'ENABLED' AND campaign.status = 'ENABLED'`, t)
  for (const r of ads) {
    const rsa = r.adGroupAd?.ad?.responsiveSearchAd || {}
    const h = (rsa.headlines || []).length, d = (rsa.descriptions || []).length
    const pinned = (rsa.headlines || []).filter((x: { pinnedField?: string }) => x.pinnedField).length
    console.log(`- [${r.campaign?.name} / ${r.adGroup?.name}] ${h} headlines (${pinned} pinned) · ${d} desc · strength=${r.adGroupAd?.adStrength} · url=${(r.adGroupAd?.ad?.finalUrls || [])[0]}`)
  }

  console.log('\n=== 4. Assets (sitelinks/callouts/snippets) ===')
  const assets = await q(`SELECT asset.type, asset.sitelink_asset.link_text, asset.callout_asset.callout_text
    FROM asset WHERE asset.type IN ('SITELINK','CALLOUT','STRUCTURED_SNIPPET')`, t)
  const porTipo: Record<string, number> = {}
  for (const r of assets) porTipo[r.asset?.type || '?'] = (porTipo[r.asset?.type || '?'] || 0) + 1
  console.log('conteo:', JSON.stringify(porTipo), assets.length === 0 ? '(NINGUNO)' : '')

  console.log('\n=== 5. Negativas existentes (campaña) + listas compartidas ===')
  const negs = await q(`SELECT campaign.name, campaign_criterion.keyword.text FROM campaign_criterion
    WHERE campaign_criterion.negative = TRUE AND campaign_criterion.type = 'KEYWORD'`, t)
  console.log(`negativas a nivel campaña: ${negs.length}`)
  const lists = await q(`SELECT shared_set.name, shared_set.type FROM shared_set WHERE shared_set.status = 'ENABLED'`, t)
  console.log(`listas compartidas: ${lists.length}`, lists.map((r: { sharedSet?: { name?: string } }) => r.sharedSet?.name).join(', '))

  console.log('\n=== 6. Quality Score (keywords activas) ===')
  const qs = await q(`SELECT ad_group_criterion.keyword.text, ad_group_criterion.quality_info.quality_score
    FROM keyword_view WHERE ad_group_criterion.status = 'ENABLED' AND campaign.status = 'ENABLED'`, t)
  for (const r of qs) console.log(`- "${r.adGroupCriterion?.keyword?.text}": QS=${r.adGroupCriterion?.qualityInfo?.qualityScore ?? 's/d'}`)

  console.log('\n=== 7. Impression share perdido (30d, por campaña) ===')
  const is = await q(`SELECT campaign.name, metrics.search_impression_share, metrics.search_budget_lost_impression_share,
    metrics.search_rank_lost_impression_share FROM campaign WHERE segments.date DURING LAST_30_DAYS AND campaign.status = 'ENABLED'`, t)
  for (const r of is) {
    const m = r.metrics || {}
    const pct = (v: unknown) => v == null ? 's/d' : `${Math.round(Number(v) * 100)}%`
    console.log(`- ${r.campaign?.name}: IS=${pct(m.searchImpressionShare)} · perdido x presupuesto=${pct(m.searchBudgetLostImpressionShare)} · perdido x ranking=${pct(m.searchRankLostImpressionShare)}`)
  }
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL:', e); process.exit(1) })
