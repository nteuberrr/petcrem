import { getSheetData } from './datastore'
import { getMensajesSupabase } from './supabase'
import { parseFecha } from './dates'
import { isGoogleAdsConfigurado, impresionesClicksPorSemana } from './google-ads'
import { EMBUDO_HISTORICO, SEMANA_CARGA_INICIAL } from './embudo-historico'

/**
 * EMBUDO SEMANAL de marketing: reproduce la tabla de conversión por semana ISO
 * (lunes–domingo) — Impresiones → Clics (CTR) → Leads WA (Clk→Lead) →
 * Ventas (Lead→Venta, Clk→Venta). Cruza tres fuentes:
 *   - Impresiones + clics: Google Ads (segments.week, arranca en lunes).
 *   - Leads: conversaciones NUEVAS de tutores por WhatsApp en el inbox (mismo
 *     conteo que lib/marketing-rentabilidad.ts — excluye el histórico importado).
 *   - Ventas: fichas DIRECTAS de tutores creadas en la semana (sin veterinaria,
 *     excluye borradores "Por ingresar" y el canal de convenio B2B).
 *
 * ⚠️ Atribución "por semana de EVENTO", no cohorte: una venta puede cerrar a
 * partir de un lead de semanas anteriores (o de tráfico directo/orgánico), así
 * que Lead→Venta puede superar el 100% — es esperado, no un error. Sin tracking
 * clic→ficha real no se puede atribuir mejor; el panel marca esos casos con ⚠️.
 */

const TZ = 'America/Santiago'

/**
 * Los leads del inbox solo son confiables desde esta semana. El inbox de WhatsApp
 * empezó a capturar el 6-jun-2026, pero con volumen parcial hasta fin de junio, y
 * los 352 chats históricos se importaron TODOS con fecha 6-jun (no la real). Antes
 * de esta fecha no existe una historia de leads fechada, así que la columna de
 * leads (y las conversiones que dependen de ella) se dejan en blanco para no
 * inventar tasas absurdas (Lead→Venta de 300%+). Impresiones/clics/ventas sí
 * tienen historia completa. Ajustar si algún día se cargan los leads históricos.
 */
export const LEADS_CONFIABLES_DESDE = '2026-06-29'

export interface FilaEmbudo {
  label: string            // "S16/26" (semana ISO / año de 2 dígitos)
  desde: string            // ISO del lunes
  hasta: string            // ISO del domingo
  impresiones: number
  clicks: number
  ctr: number | null       // % (clicks / impresiones)
  leads: number | null     // null si no hay dato de leads esa semana
  clkLead: number | null   // % (leads / clicks)
  ventas: number | null    // null si el dato no es confiable (semana de carga inicial)
  leadVenta: number | null // % (ventas / leads) — puede ser > 100
  clkVenta: number | null  // % (ventas / clicks)
  nota?: string            // anotación del registro (evento de esa semana)
  historico?: boolean      // la semana viene del registro manual (pre-API)
}

export interface EmbudoSemanal {
  filas: FilaEmbudo[]
  avisos: string[]
  googleOk: boolean        // hubo datos de Google Ads
  leadsOk: boolean         // el inbox respondió (si no, la columna Leads va en blanco)
  leadsDesde: string       // fecha desde la que los leads son confiables (antes van "—")
}

function hoyChile(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
function addDiasISO(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}
/** Lunes (ISO) de la semana que contiene la fecha dada. */
function lunesDe(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const dow = (dt.getUTCDay() + 6) % 7 // lunes=0 … domingo=6
  dt.setUTCDate(dt.getUTCDate() - dow)
  return dt.toISOString().slice(0, 10)
}
/** Etiqueta ISO "S##/YY" a partir del lunes de la semana. */
function etiquetaISO(lunesIso: string): string {
  const [y, m, d] = lunesIso.split('-').map(Number)
  const jue = new Date(Date.UTC(y, m - 1, d)) // el jueves define el año/semana ISO
  jue.setUTCDate(jue.getUTCDate() + 3)
  const anio = jue.getUTCFullYear()
  const primerJue = new Date(Date.UTC(anio, 0, 4))
  primerJue.setUTCDate(primerJue.getUTCDate() - ((primerJue.getUTCDay() + 6) % 7) + 3)
  const semana = 1 + Math.round((jue.getTime() - primerJue.getTime()) / (7 * 24 * 3600 * 1000))
  return `S${String(semana).padStart(2, '0')}/${String(anio).slice(2)}`
}
const pct = (a: number, b: number): number | null => (b > 0 ? Math.round((a / b) * 1000) / 10 : null)

export async function calcularEmbudoSemanal(semanas = 16): Promise<EmbudoSemanal> {
  const n = Math.min(52, Math.max(2, Math.round(semanas)))
  const lunesHoy = lunesDe(hoyChile())
  // Lunes de las últimas n semanas, de más antigua a la actual (la última es la semana en curso).
  const lunes: string[] = []
  for (let i = n - 1; i >= 0; i--) lunes.push(addDiasISO(lunesHoy, -7 * i))
  const primerLunes = lunes[0]
  const ultimoDomingo = addDiasISO(lunes[lunes.length - 1], 6)
  const avisos: string[] = []

  // ── Google Ads: impresiones + clics por semana ──
  let googleMap = new Map<string, { impresiones: number; clicks: number }>()
  let googleOk = false
  if (isGoogleAdsConfigurado()) {
    try {
      googleMap = await impresionesClicksPorSemana(primerLunes, ultimoDomingo)
      googleOk = googleMap.size > 0
    } catch (e) {
      avisos.push(`Google Ads no disponible: ${e instanceof Error ? e.message : 'error'}`)
    }
  } else {
    avisos.push('Google Ads no está configurado.')
  }

  // ── Leads: conteo por semana de conversaciones nuevas de tutores (WhatsApp) ──
  // Un conteo HEAD por semana (mismo criterio que marketing-rentabilidad) — evita
  // el tope de filas de Supabase y mantiene la definición de "lead" consistente.
  let leadsPorSemana: number[] = []
  let leadsOk = false
  try {
    leadsPorSemana = await Promise.all(lunes.map(async (l) => {
      const dom = addDiasISO(l, 6)
      const { count, error } = await getMensajesSupabase()
        .from('mensajes_conversaciones')
        .select('id', { count: 'exact', head: true })
        .eq('canal', 'whatsapp')
        .eq('audiencia', 'A')
        .neq('fuente', 'historico')
        .gte('created_at', `${l}T00:00:00-04:00`)
        .lte('created_at', `${dom}T23:59:59-04:00`)
      if (error) throw new Error(error.message)
      return count ?? 0
    }))
    leadsOk = true
  } catch (e) {
    avisos.push(`Leads del inbox no disponibles: ${e instanceof Error ? e.message : 'error'}`)
  }

  // ── Ventas: fichas DIRECTAS de tutores creadas en la semana ──
  const ventasMap = new Map<string, number>()
  try {
    const clientes = await getSheetData('clientes')
    for (const c of clientes) {
      if ((c.estado || '').toLowerCase() === 'borrador') continue     // aún no es venta
      if ((c.veterinaria_id || '').trim()) continue                   // convenio B2B, no ads
      const d = parseFecha(c.fecha_creacion || '')
      if (!d) continue
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      if (iso < primerLunes || iso > ultimoDomingo) continue
      const l = lunesDe(iso)
      ventasMap.set(l, (ventasMap.get(l) ?? 0) + 1)
    }
  } catch (e) {
    avisos.push(`Fichas no disponibles: ${e instanceof Error ? e.message : 'error'}`)
  }

  const filas: FilaEmbudo[] = lunes.map((l, i) => {
    const g = googleMap.get(l) || { impresiones: 0, clicks: 0 }
    const hist = EMBUDO_HISTORICO[l]

    // LEADS: registro manual si esa semana lo tiene; si no, el inbox en vivo — pero
    // solo desde LEADS_CONFIABLES_DESDE (antes no hay historia de leads fechada → "—").
    let leads: number | null
    if (hist?.leads != null) leads = hist.leads
    else leads = leadsOk && l >= LEADS_CONFIABLES_DESDE ? (leadsPorSemana[i] ?? 0) : null

    // VENTAS: registro manual si lo tiene; la semana de carga inicial se descarta
    // (pico irreal de migración → "—"); si no, las fichas directas del sistema.
    let ventas: number | null
    if (hist?.ventas != null) ventas = hist.ventas
    else if (l === SEMANA_CARGA_INICIAL) ventas = null
    else ventas = ventasMap.get(l) ?? 0

    return {
      label: etiquetaISO(l),
      desde: l,
      hasta: addDiasISO(l, 6),
      impresiones: g.impresiones,
      clicks: g.clicks,
      ctr: pct(g.clicks, g.impresiones),
      leads,
      clkLead: leads != null ? pct(leads, g.clicks) : null,
      ventas,
      leadVenta: leads != null && ventas != null ? pct(ventas, leads) : null,
      clkVenta: ventas != null ? pct(ventas, g.clicks) : null,
      nota: hist?.nota,
      historico: hist != null,
    }
  })

  return { filas, avisos, googleOk, leadsOk, leadsDesde: LEADS_CONFIABLES_DESDE }
}
