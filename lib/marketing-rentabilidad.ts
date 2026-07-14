import { getSheetData } from './datastore'
import { getMensajesSupabase } from './supabase'
import { parseFecha } from './dates'
import { fmtPrecio } from './format'
import { getMarketingParams } from './marketing-params'
import { isGoogleAdsConfigurado, resumenCampanas } from './google-ads'
import { isInsightsConfigurado, resumenAds } from './meta-insights'

/**
 * RENTABILIDAD REAL del marketing: cruza el GASTO en ads (Google + Meta) contra los
 * resultados del propio sistema — leads del inbox de WhatsApp, fichas nuevas de
 * `clientes` e ingresos reales (precio_total) — para calcular CPA/CPL/ROAS/ticket/
 * tasa de cierre REALES del período. Es la métrica que manda: las de plataforma
 * (CTR, CPC, "conversiones") son solo diagnóstico.
 *
 * Atribución: BLENDED (todo el gasto vs todas las fichas de tutores del período).
 * No hay tracking clic→ficha todavía, así que separa fichas DIRECTAS (tutores, las
 * que mueven los ads) de las DE CONVENIO (traídas por veterinarias, canal B2B) y
 * lo declara como aproximación — nunca vender el blended como atribución exacta.
 */

export type PeriodoRentabilidad = 'last_7d' | 'last_14d' | 'last_30d' | 'this_month' | 'last_month'

export interface Rentabilidad {
  periodo: PeriodoRentabilidad
  desde: string
  hasta: string
  gastoGoogle: number | null      // null = plataforma no configurada
  gastoMeta: number | null
  gastoTotal: number
  leadsWhatsapp: number | null    // conversaciones nuevas de tutores (proxy de leads)
  fichasDirectas: number          // fichas de tutores (sin veterinaria) — las que mueven los ads
  fichasConvenio: number          // fichas traídas por veterinarias (canal B2B)
  ingresosDirectos: number
  ingresosConvenio: number
  ticketPromedio: number          // ingresos directos / fichas directas
  tasaCierrePct: number | null    // fichas directas / leads
  cplReal: number | null          // gasto / leads
  cpaReal: number | null          // gasto / fichas directas
  roasBlended: number | null      // ingresos directos / gasto
  avisos: string[]
}

const TZ = 'America/Santiago'

function hoyChile(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
function addDias(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

/** Rango [desde, hasta] ISO (Chile) equivalente al date_preset de las plataformas. */
export function rangoDePeriodo(periodo: PeriodoRentabilidad): { desde: string; hasta: string } {
  const hoy = hoyChile()
  if (periodo === 'this_month') return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy }
  if (periodo === 'last_month') {
    const primeroEste = `${hoy.slice(0, 7)}-01`
    const finAnterior = addDias(primeroEste, -1)
    return { desde: `${finAnterior.slice(0, 7)}-01`, hasta: finAnterior }
  }
  const dias = periodo === 'last_7d' ? 7 : periodo === 'last_14d' ? 14 : 30
  // Los presets last_Nd de las plataformas terminan AYER; replicamos eso.
  const ayer = addDias(hoy, -1)
  return { desde: addDias(ayer, -(dias - 1)), hasta: ayer }
}

function enRango(fechaRaw: string, desde: string, hasta: string): boolean {
  const d = parseFecha(fechaRaw)
  if (!d) return false
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return iso >= desde && iso <= hasta
}

const monto = (v: string | undefined): number => {
  const n = parseFloat(String(v ?? '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : 0
}

export async function calcularRentabilidad(periodo: PeriodoRentabilidad = 'last_30d'): Promise<Rentabilidad> {
  const { desde, hasta } = rangoDePeriodo(periodo)
  const avisos: string[] = []

  const [gastoGoogle, gastoMeta, clientes, leadsWhatsapp] = await Promise.all([
    // Gasto Google Ads
    (async (): Promise<number | null> => {
      if (!isGoogleAdsConfigurado()) return null
      try { return (await resumenCampanas(periodo)).cuenta.gasto } catch (e) {
        avisos.push(`Google Ads no disponible: ${e instanceof Error ? e.message : 'error'}`)
        return null
      }
    })(),
    // Gasto Meta Ads
    (async (): Promise<number | null> => {
      if (!isInsightsConfigurado()) return null
      try { return (await resumenAds({ datePreset: periodo })).cuenta.spend } catch (e) {
        avisos.push(`Meta Ads no disponible: ${e instanceof Error ? e.message : 'error'}`)
        return null
      }
    })(),
    getSheetData('clientes'),
    // Leads: conversaciones NUEVAS de tutores por WhatsApp en el período (proxy).
    (async (): Promise<number | null> => {
      try {
        const { count, error } = await getMensajesSupabase()
          .from('mensajes_conversaciones')
          .select('id', { count: 'exact', head: true })
          .eq('canal', 'whatsapp')
          .eq('audiencia', 'A')
          .neq('fuente', 'historico')
          .gte('created_at', `${desde}T00:00:00-04:00`)
          .lte('created_at', `${hasta}T23:59:59-04:00`)
        if (error) throw new Error(error.message)
        return count ?? 0
      } catch (e) {
        avisos.push(`Leads del inbox no disponibles: ${e instanceof Error ? e.message : 'error'}`)
        return null
      }
    })(),
  ])

  // Fichas del período (excluye borradores "Por ingresar": todavía no son venta).
  let fichasDirectas = 0, fichasConvenio = 0, ingresosDirectos = 0, ingresosConvenio = 0
  for (const c of clientes) {
    if ((c.estado || '').toLowerCase() === 'borrador') continue
    if (!enRango(c.fecha_creacion || '', desde, hasta)) continue
    const ingreso = monto(c.precio_total) || monto(c.precio_servicio)
    if ((c.veterinaria_id || '').trim()) { fichasConvenio++; ingresosConvenio += ingreso }
    else { fichasDirectas++; ingresosDirectos += ingreso }
  }

  const gastoTotal = (gastoGoogle ?? 0) + (gastoMeta ?? 0)
  const div = (a: number, b: number | null): number | null => (b && b > 0 ? Math.round(a / b) : null)

  return {
    periodo, desde, hasta,
    gastoGoogle, gastoMeta, gastoTotal,
    leadsWhatsapp,
    fichasDirectas, fichasConvenio, ingresosDirectos, ingresosConvenio,
    ticketPromedio: fichasDirectas > 0 ? Math.round(ingresosDirectos / fichasDirectas) : 0,
    tasaCierrePct: leadsWhatsapp && leadsWhatsapp > 0 ? Math.round((fichasDirectas / leadsWhatsapp) * 1000) / 10 : null,
    cplReal: gastoTotal > 0 ? div(gastoTotal, leadsWhatsapp) : null,
    cpaReal: gastoTotal > 0 ? div(gastoTotal, fichasDirectas) : null,
    roasBlended: gastoTotal > 0 ? Math.round((ingresosDirectos / gastoTotal) * 10) / 10 : null,
    avisos,
  }
}

/** Reporte en texto para el agente (compara contra los objetivos configurados). */
export async function reporteRentabilidadTexto(periodo: PeriodoRentabilidad = 'last_30d'): Promise<string> {
  const [r, params] = await Promise.all([calcularRentabilidad(periodo), getMarketingParams()])
  const na = 'no configurado'
  const lineas = [
    `RENTABILIDAD REAL (${r.desde} → ${r.hasta}) — gasto en ads vs resultados del SISTEMA (fichas e ingresos reales, no métricas de plataforma):`,
    `- Gasto: Google Ads ${r.gastoGoogle == null ? na : fmtPrecio(r.gastoGoogle)} · Meta ${r.gastoMeta == null ? na : fmtPrecio(r.gastoMeta)} · TOTAL ${fmtPrecio(r.gastoTotal)}`,
    `- Leads (conversaciones nuevas de tutores por WhatsApp): ${r.leadsWhatsapp ?? 's/d'}`,
    `- Fichas DIRECTAS (tutores, las que mueven los ads): ${r.fichasDirectas} → ingresos ${fmtPrecio(r.ingresosDirectos)} (ticket promedio ${fmtPrecio(r.ticketPromedio)})`,
    `- Fichas de CONVENIO (traídas por veterinarias, canal B2B): ${r.fichasConvenio} → ingresos ${fmtPrecio(r.ingresosConvenio)}`,
    `- Tasa de cierre real (fichas directas / leads): ${r.tasaCierrePct == null ? 's/d' : r.tasaCierrePct + '%'}`,
  ]
  if (r.gastoTotal > 0) {
    const objCpl = params.cpl_objetivo_clp
    const objCpa = params.cpa_objetivo_clp
    lineas.push(
      `- CPL real (gasto total / leads): ${r.cplReal == null ? 's/d' : fmtPrecio(r.cplReal)}${objCpl ? ` (objetivo ${fmtPrecio(objCpl)} → ${r.cplReal != null && r.cplReal <= objCpl ? 'DENTRO' : 'FUERA'})` : ''}`,
      `- CPA real (gasto total / fichas directas): ${r.cpaReal == null ? 's/d' : fmtPrecio(r.cpaReal)}${objCpa ? ` (objetivo ${fmtPrecio(objCpa)} → ${r.cpaReal != null && r.cpaReal <= objCpa ? 'DENTRO' : 'FUERA'})` : ''}`,
      `- ROAS blended (ingresos directos / gasto total): ${r.roasBlended == null ? 's/d' : r.roasBlended + 'x'}`,
    )
  } else {
    lineas.push('- Sin gasto en ads en el período (o plataformas no configuradas): no aplican CPA/CPL/ROAS.')
  }
  lineas.push('ATRIBUCIÓN: es BLENDED (todo el gasto vs todas las fichas de tutores del período; los leads incluyen orgánico). Sirve como techo/piso, NO como atribución exacta por campaña — decláralo así al reportar.')
  if (r.avisos.length) lineas.push(`Avisos: ${r.avisos.join('; ')}`)
  return lineas.join('\n')
}
