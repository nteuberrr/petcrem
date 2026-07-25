import { getSheetData } from './datastore'
import { getMensajesSupabase } from './supabase'
import { parseFecha } from './dates'
import { fmtPrecio } from './format'
import { getMarketingParams } from './marketing-params'
import { isGoogleAdsConfigurado, resumenCampanas } from './google-ads'
import { isInsightsConfigurado, resumenAds } from './meta-insights'
import { labelOrigen } from './origen-cliente'

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
  /** Fichas directas desglosadas por cómo llegó el cliente (clientes.origen). */
  porOrigen: Array<{ valor: string; label: string; fichas: number; ingresos: number }>
  /** % de fichas directas con origen registrado — bajo 50% el desglose no decide nada. */
  coberturaOrigenPct: number
  avisos: string[]
}

/** Los bot_* dicen POR DÓNDE entró el mensaje, no de qué canal venía el cliente. */
const ORIGENES_DE_CONTACTO = new Set(['bot_retiro', 'bot_eutanasia', 'bot_vet'])

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
  const acumOrigen = new Map<string, { fichas: number; ingresos: number }>()
  let conOrigen = 0
  for (const c of clientes) {
    if ((c.estado || '').toLowerCase() === 'borrador') continue
    if (!enRango(c.fecha_creacion || '', desde, hasta)) continue
    const ingreso = monto(c.precio_total) || monto(c.precio_servicio)
    if ((c.veterinaria_id || '').trim()) { fichasConvenio++; ingresosConvenio += ingreso }
    else {
      fichasDirectas++; ingresosDirectos += ingreso
      const org = (c.origen || '').trim()
      if (org) conOrigen++
      const k = org || '(sin registrar)'
      const prev = acumOrigen.get(k) || { fichas: 0, ingresos: 0 }
      acumOrigen.set(k, { fichas: prev.fichas + 1, ingresos: prev.ingresos + ingreso })
    }
  }
  const porOrigen = [...acumOrigen.entries()]
    .map(([valor, v]) => ({ valor, label: valor === '(sin registrar)' ? 'Sin registrar' : labelOrigen(valor), ...v }))
    .sort((a, b) => b.fichas - a.fichas)

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
    porOrigen,
    coberturaOrigenPct: fichasDirectas > 0 ? Math.round((conOrigen / fichasDirectas) * 1000) / 10 : 0,
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
  // Desglose por CÓMO LLEGÓ el cliente (clientes.origen). Es la única vía para
  // pasar del CPA blended al costo real por canal; mientras la cobertura sea baja,
  // se reporta como referencia y NO se usa para decidir presupuesto.
  if (r.porOrigen.length) {
    lineas.push(`- Fichas directas por ORIGEN (cobertura ${r.coberturaOrigenPct}% de las fichas con el dato registrado):`)
    for (const o of r.porOrigen) {
      const esContacto = ORIGENES_DE_CONTACTO.has(o.valor)
      lineas.push(`   · ${o.label}: ${o.fichas} ficha(s) · ${fmtPrecio(o.ingresos)}${esContacto ? ' — ojo: dice por dónde ENTRÓ el mensaje, no de qué canal venía' : ''}`)
    }
    if (r.coberturaOrigenPct < 50) {
      lineas.push('   ⚠ Cobertura baja: el equipo todavía no registra el origen en la mayoría de las fichas. NO uses este desglose para mover presupuesto; sirve solo como referencia hasta llegar al 70–80%.')
    } else if (r.gastoGoogle != null) {
      const g = r.porOrigen.find(o => o.valor === 'google')
      if (g && g.fichas > 0) lineas.push(`   → Costo real por ficha de Google: ${fmtPrecio(Math.round(r.gastoGoogle / g.fichas))} (gasto de Google / fichas marcadas como Google)`)
    }
  }
  // Velocidad real del sitio (usuarios de verdad, no laboratorio). Importa acá
  // porque la experiencia de la página de destino es parte del Ad Rank: un sitio
  // lento sube el costo por clic sin que se vea en ninguna métrica de campaña.
  try {
    const { resumenVitals, veredictoLcp } = await import('./web-vitals')
    const v = await resumenVitals(28)
    if (v.muestras > 0) {
      lineas.push(`- Velocidad del sitio (visitas reales, últimos 28 días, ${v.muestras} mediciones):`)
      for (const d of v.porDispositivo) {
        lineas.push(`   · ${d.dispositivo}: LCP ${veredictoLcp(d.lcp)} · ${d.muestras} visitas` +
          (d.cls != null ? ` · CLS ${d.cls}` : '') + (d.inp != null ? ` · INP ${Math.round(d.inp)} ms` : ''))
      }
      if (v.peoresRutas.length) {
        lineas.push(`   · páginas más lentas: ${v.peoresRutas.map(r => `${r.ruta} (${veredictoLcp(r.lcp)})`).join(' · ')}`)
      }
    }
  } catch { /* la tabla puede no existir todavía: el reporte sale igual */ }

  lineas.push('ATRIBUCIÓN: es BLENDED (todo el gasto vs todas las fichas de tutores del período; los leads incluyen orgánico). Sirve como techo/piso, NO como atribución exacta por campaña — decláralo así al reportar.')
  if (r.avisos.length) lineas.push(`Avisos: ${r.avisos.join('; ')}`)
  return lineas.join('\n')
}
