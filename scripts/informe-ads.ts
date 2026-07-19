/**
 * INFORME DE PUBLICIDAD (Google Ads + Meta) — PDF branded adjunto, data EN VIVO.
 *
 *   npx tsx scripts/informe-ads.ts [correo] [periodo]
 *
 * - correo: destino (default nicoteuber@gmail.com)
 * - periodo: last_7d | last_14d | last_30d | this_month | last_month (default last_14d)
 *
 * Trae métricas reales de Google Ads (incl. impression share = vs mercado) y Meta,
 * arma una SERIE DIARIA (gasto vs fichas) para el gráfico evolutivo, cruza la
 * rentabilidad real, le pide a Claude un análisis BREVE + acciones priorizadas, y
 * genera un PDF de imprenta (lib/informe-ads-pdf) que envía adjunto por correo.
 * Skill: /informe-ads.
 */
import './_env-preload'
import Anthropic from '@anthropic-ai/sdk'
import { isGoogleAdsConfigurado, resumenCampanas, serieDiariaGoogle } from '../lib/google-ads'
import { isInsightsConfigurado, resumenAds, serieDiariaMeta } from '../lib/meta-insights'
import { calcularRentabilidad, rangoDePeriodo, type PeriodoRentabilidad } from '../lib/marketing-rentabilidad'
import { getMarketingParams } from '../lib/marketing-params'
import { getSheetData } from '../lib/datastore'
import { parseFecha } from '../lib/dates'
import { sendEmail } from '../lib/resend-mailer'
import { fmtPrecio } from '../lib/format'
import { renderEmailLayout, getContacto, escapeHtml } from '../lib/email-layout'
import { generarInformeAdsPdf, type AdsAccion } from '../lib/informe-ads-pdf'

const DESTINO = process.argv[2] || 'nicoteuber@gmail.com'
const PERIODO = (process.argv[3] || 'last_14d') as PeriodoRentabilidad
const dmy = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}` }

interface Analisis { resumen: string; lecturas: { titulo: string; detalle: string }[]; acciones: AdsAccion[] }

async function analizar(ctx: string): Promise<Analisis | null> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  const client = new Anthropic({ apiKey: key })
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'
  const sys = `Eres un media buyer senior (Google Ads + Meta) analizando la cuenta de "Crematorio Alma Animal" (crematorio de mascotas, Santiago de Chile, cobertura RM). El negocio mide su éxito por FICHAS de tutores e INGRESOS reales, no por métricas de plataforma. El "vs mercado" en Google se lee del IMPRESSION SHARE y del % de impresiones perdidas por PRESUPUESTO (falta plata) vs por RANKING (calidad/puja). No inventes benchmarks que no estén en los datos.

REGLA DE ESTILO — MÁXIMA BREVEDAD (esto es clave, va a un PDF ejecutivo):
- resumen: 2 frases, directo.
- cada lectura "detalle": UNA frase de máximo 14 palabras, con el dato.
- cada acción: "accion" imperativa y corta (máx 10 palabras); "motivo" UNA frase de máx 16 palabras con el dato que la respalda.
Nada de relleno ni floritura.

EXACTITUD: usa EXACTAMENTE los números del JSON (fichas directas, gasto, %, CPA); no los redondees a otro valor ni inventes cifras que no estén.

Responde SOLO con JSON válido (sin markdown), forma exacta:
{"resumen":"...","lecturas":[{"titulo":"2-4 palabras","detalle":"..."}],"acciones":[{"prioridad":"Alta|Media|Baja","accion":"...","motivo":"...","esfuerzo":"Bajo|Medio|Alto"}]}
3-5 lecturas y 4-7 acciones, de mayor a menor prioridad, en español neutro.`
  try {
    const resp = await client.messages.create({ model, max_tokens: 2200, system: sys, messages: [{ role: 'user', content: ctx }] })
    const txt = resp.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('').trim()
    const ini = txt.indexOf('{'), fin = txt.lastIndexOf('}')
    const parsed = JSON.parse(ini >= 0 && fin > ini ? txt.slice(ini, fin + 1) : txt) as Analisis
    if (!Array.isArray(parsed.acciones)) return null
    return parsed
  } catch (e) {
    console.warn('[informe-ads] análisis IA falló:', e instanceof Error ? e.message : e)
    return null
  }
}

function rangoFechas(desde: string, hasta: string): string[] {
  const out: string[] = []
  const [y, m, d] = desde.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const fin = hasta
  for (let i = 0; i < 400; i++) {
    const iso = dt.toISOString().slice(0, 10)
    out.push(iso)
    if (iso >= fin) break
    dt.setUTCDate(dt.getUTCDate() + 1)
  }
  return out
}

async function main() {
  const { desde, hasta } = rangoDePeriodo(PERIODO)
  console.log(`Informe de ads ${desde} → ${hasta} (${PERIODO}) → ${DESTINO}\n`)

  const [g, m, r, params, contacto, serG, serM, clientes] = await Promise.all([
    isGoogleAdsConfigurado() ? resumenCampanas(PERIODO).catch(e => { console.warn('Google:', e.message); return null }) : Promise.resolve(null),
    isInsightsConfigurado() ? resumenAds({ datePreset: PERIODO }).catch(e => { console.warn('Meta:', e.message); return null }) : Promise.resolve(null),
    calcularRentabilidad(PERIODO),
    getMarketingParams().catch(() => null),
    getContacto(),
    isGoogleAdsConfigurado() ? serieDiariaGoogle('last_30d').catch(() => []) : Promise.resolve([]),
    isInsightsConfigurado() ? serieDiariaMeta('last_30d').catch(() => []) : Promise.resolve([]),
    getSheetData('clientes').catch(() => [] as Record<string, string>[]),
  ])

  // Serie diaria de fichas directas (últimos 30 días)
  const win = rangoDePeriodo('last_30d')
  const fechas = rangoFechas(win.desde, win.hasta)
  const gMap = new Map(serG.map(p => [p.fecha, p.gasto]))
  const mMap = new Map(serM.map(p => [p.fecha, p.spend]))
  const fMap = new Map<string, number>()
  for (const c of clientes) {
    if ((c.estado || '').toLowerCase() === 'borrador') continue
    if ((c.veterinaria_id || '').trim()) continue
    const d = parseFecha(c.fecha_creacion || '')
    if (!d) continue
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (iso < win.desde || iso > win.hasta) continue
    fMap.set(iso, (fMap.get(iso) || 0) + 1)
  }
  const serie = fechas.map(fecha => ({ fecha, gasto: Math.round((gMap.get(fecha) || 0) + (mMap.get(fecha) || 0)), fichas: fMap.get(fecha) || 0 }))

  // Impression share ponderado por gasto
  let isPond: number | null = null
  if (g) {
    const conIS = g.campanas.filter(c => c.impressionShare != null && c.gasto > 0)
    const tot = conIS.reduce((s, c) => s + c.gasto, 0)
    if (tot > 0) isPond = Math.round(conIS.reduce((s, c) => s + c.impressionShare! * c.gasto, 0) / tot * 10) / 10
  }

  const objCpa = params?.cpa_objetivo_clp ?? null
  const objCpl = params?.cpl_objetivo_clp ?? null

  const ctx = JSON.stringify({
    periodo: { desde, hasta },
    google: g ? { moneda: g.moneda, cuenta: g.cuenta, comparacion: g.comparacion, impression_share_ponderado: isPond, campanas: g.campanas.map(c => ({ nombre: c.nombre, gasto: c.gasto, clicks: c.clicks, ctr: c.ctr, cpc: c.cpc, conversiones: c.conversiones, cpa: c.costoPorConversion, impression_share: c.impressionShare, perdido_presupuesto: c.perdidoPorPresupuesto, perdido_ranking: c.perdidoPorRanking })) } : 'no configurado',
    meta: m ? { moneda: m.moneda, cuenta: m.cuenta, campanas: m.campanas } : 'no configurado',
    rentabilidad_real: r,
    evolucion_30d: serie,
    objetivos: { cpa_objetivo: objCpa, cpl_objetivo: objCpl },
  })

  console.log('Pidiendo análisis a la IA…')
  const analisis = (await analizar(ctx)) || { resumen: '', lecturas: [], acciones: [] }

  console.log('Generando PDF…')
  const pdf = await generarInformeAdsPdf({
    desde, hasta, contacto: { nombre: contacto.nombre, web: contacto.web },
    rent: r, google: g, isPond, meta: m, objCpa, objCpl, serie, analisis,
  })

  // Modo debug: `... [correo] [periodo] --save <ruta>` guarda el PDF y NO envía.
  const saveIdx = process.argv.indexOf('--save')
  if (saveIdx > 0 && process.argv[saveIdx + 1]) {
    const { writeFileSync } = await import('fs')
    writeFileSync(process.argv[saveIdx + 1], pdf)
    console.log(`PDF guardado en ${process.argv[saveIdx + 1]} (${(pdf.byteLength / 1024).toFixed(0)}KB) — no se envió correo.`)
    return
  }

  const cuerpo = `
    <p style="margin:0 0 14px;font-size:15px">Hola,</p>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.6">Adjuntamos el <strong>Informe de Publicidad</strong> del período <strong>${escapeHtml(dmy(desde))} – ${escapeHtml(dmy(hasta))}</strong> (Google Ads + Meta), con la evolución del gasto vs las fichas, el detalle por campaña, la rentabilidad real y un listado de acciones recomendadas.</p>
    <p style="margin:0 0 6px;font-size:14px;line-height:1.6"><strong>Resumen:</strong> gasto ${escapeHtml(fmtPrecio(r.gastoTotal))} · ${r.fichasDirectas} fichas directas · ROAS ${r.roasBlended == null ? '—' : r.roasBlended + 'x'} · ${analisis.acciones.length} acciones sugeridas.</p>
    <p style="margin:12px 0 0;font-size:13px;line-height:1.6;color:#475569">El detalle completo, los gráficos y el análisis están en el PDF adjunto.</p>`

  const res = await sendEmail({
    to: DESTINO,
    subject: `Informe de Publicidad — ${dmy(desde)} a ${dmy(hasta)}`,
    from: 'Crematorio Alma Animal <contacto@crematorioalmaanimal.cl>',
    preview_text: `Google Ads + Meta · gasto ${fmtPrecio(r.gastoTotal)} · ${r.fichasDirectas} fichas · ${analisis.acciones.length} acciones`,
    html: renderEmailLayout({ titulo: 'Informe de Publicidad', bodyHtml: cuerpo, contacto, contexto: 'Marketing' }),
    attachments: [{ filename: `Informe_Publicidad_${desde}_a_${hasta}.pdf`, content: pdf, content_type: 'application/pdf' }],
  })
  console.log(res.ok ? `\n✓ Enviado a ${DESTINO} (message_id=${res.message_id})` : `\n✗ Falló: ${res.error}`)
  console.log(`  Gasto ${fmtPrecio(r.gastoTotal)} · ${r.fichasDirectas} fichas · ${analisis.acciones.length} acciones · PDF ${(pdf.byteLength / 1024).toFixed(0)}KB`)
}

main().catch(e => { console.error('ERROR:', e instanceof Error ? e.stack || e.message : e); process.exit(1) })
