import {
  isGoogleAdsConfigurado, esTokenVencido,
  listarAdsConProblemas, gastoDeAyerPorCampana, resumenCampanas, terminosBusqueda,
} from './google-ads'
import { auditarCuenta, type Hallazgo } from './google-ads-audit'
import { calcularRentabilidad } from './marketing-rentabilidad'
import { resumenAtribucion } from './ads-clicks'
import { medirLiftSeguimiento } from './seguimiento-leads'
import { avisarAdminsWhatsapp, isWhatsappConfigured } from './whatsapp'

/**
 * Vigilancia automática de Google Ads (pedida por el dueño 2026-07-15). Dos niveles,
 * ambos colgados del cron diario de las 11:00 Chile (app/api/mensajes/cron-archivar —
 * Vercel Hobby permite solo 2 crons, por eso se encadena ahí):
 *
 *  1) GUARDIA DIARIA (silenciosa): solo escribe al ADMIN_WHATSAPP si detecta algo que
 *     no puede esperar — anuncio rechazado, campaña frenada (gasto $0), CPL real
 *     disparado, token de la API vencido. Si está todo bien, NO manda nada.
 *  2) INFORME SEMANAL (lunes): resumen de la semana (gasto/conversiones/IS vs semana
 *     anterior), rentabilidad REAL del negocio (fichas e ingresos, no plataforma),
 *     la atribución clic → ficha (lib/ads-clicks), los términos de búsqueda que
 *     gastaron sin convertir —listos para negativizar— y los hallazgos priorizados
 *     de la auditoría automática.
 *
 * SOLO LECTURA + WhatsApp: nunca muta nada en Google Ads — el informe propone y el
 * humano decide (regla del proyecto: las acciones se ejecutan desde el panel/agente).
 * Kill-switch: GADS_VIGILANCIA=false. Best-effort: cualquier error se loguea y no
 * rompe el resto del cron.
 */

const TZ = 'America/Santiago'

// Umbrales de la guardia (conservadores para no hacer ruido; ajustar aquí si molestan).
const CPL_UMBRAL = 15_000       // CPL real 7d ~2× el histórico ($7.200 al 2026-07-15)
const GASTO_MIN_PARA_CPL = 100_000  // no evaluar CPL con gasto 7d chico (ruido)
const GASTO_MIN_SIN_LEADS = 50_000  // gasto 7d sin NINGÚN lead → algo está roto

// Términos de búsqueda que queman plata: en la revisión de agosto de 2026, 132
// términos sin una sola conversión se llevaron $181.870 en 30 días (33 % del
// gasto). El informe los lista para negativizarlos, que era el paso que faltaba.
const TERMINO_GASTO_MIN = 3_000  // por debajo de esto todavía no hay señal
const TERMINOS_EN_INFORME = 6

const fmt = (n: number) => '$' + Math.round(n).toLocaleString('es-CL')

function esLunesChile(): boolean {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(new Date()) === 'Mon'
}

export interface ResultadoVigilancia {
  guardia: { hallazgos: number; enviado: boolean; mensaje: string | null }
  informe: { corresponde: boolean; enviado: boolean; mensaje: string | null }
}

/** Guardia diaria: junta los problemas urgentes. Devuelve las líneas del aviso ([] = todo bien). */
export async function chequeosGuardia(): Promise<string[]> {
  const lineas: string[] = []

  // 1) Anuncios activos rechazados / limitados por políticas.
  try {
    const malos = await listarAdsConProblemas()
    for (const a of malos) {
      const grave = a.approvalStatus === 'DISAPPROVED'
      lineas.push(`${grave ? '🔴' : '🟠'} Anuncio ${grave ? 'RECHAZADO' : 'aprobado con límites'} en ${a.campana} / ${a.grupoAnuncio} — revisar en Google Ads (Anuncios) y corregir la política infringida.`)
    }
  } catch (e) {
    if (esTokenVencido(e)) return ['🔴 El token de la API de Google Ads VENCIÓ — la vigilancia y el panel quedaron ciegos. Regenerarlo con scripts/google-ads-refresh-token.ts.']
    console.warn('[gads-vigilancia] ads con problemas:', e)
  }

  // 2) Campañas frenadas: presupuesto asignado pero gasto $0 ayer.
  try {
    const ayer = await gastoDeAyerPorCampana()
    for (const c of ayer) {
      if (c.presupuesto > 0 && c.gasto === 0) {
        lineas.push(`🔴 "${c.nombre}" gastó $0 ayer con ${fmt(c.presupuesto)}/día de presupuesto — posible pago rechazado o anuncios sin servir. Revisar Facturación/Anuncios.`)
      }
    }
  } catch (e) { console.warn('[gads-vigilancia] gasto de ayer:', e) }

  // 3) Economía real de la última semana (fichas/leads del sistema, no plataforma).
  try {
    const r = await calcularRentabilidad('last_7d')
    if (r.gastoTotal >= GASTO_MIN_SIN_LEADS && (r.leadsWhatsapp ?? 0) === 0 && r.fichasDirectas === 0) {
      lineas.push(`🔴 ${fmt(r.gastoTotal)} gastados en 7 días y CERO leads/fichas registrados — o se rompió el tracking o las campañas traen tráfico que no convierte. Revisar urgente.`)
    } else if (r.gastoTotal >= GASTO_MIN_PARA_CPL && r.cplReal != null && r.cplReal > CPL_UMBRAL) {
      lineas.push(`🟠 CPL real de la semana: ${fmt(r.cplReal)} (umbral ${fmt(CPL_UMBRAL)}; histórico ~$7.200). Gasto 7d ${fmt(r.gastoTotal)}, ${r.leadsWhatsapp ?? 0} leads. Vigilar — si sigue así, frenar el último cambio.`)
    }
  } catch (e) { console.warn('[gads-vigilancia] rentabilidad 7d:', e) }

  return lineas
}

function lineaHallazgo(h: Hallazgo): string {
  const icono = h.severidad === 'alta' ? '🔴' : h.severidad === 'media' ? '🟠' : '🟡'
  const plata = h.dolaresEstimados ? ` (~${fmt(h.dolaresEstimados)})` : ''
  return `${icono} ${h.titulo}${plata}\n   → ${h.accionSugerida}`
}

/**
 * Términos de búsqueda de la semana que gastaron sin convertir. Es la lista para
 * negativizar el lunes; sin ella la revisión quedaba dependiendo de que alguien
 * se acordara de entrar a mirarla.
 */
export async function terminosQueQuemanPlata(): Promise<{ lineas: string[]; total: number }> {
  try {
    const { terminos } = await terminosBusqueda('last_7d', 200)
    const malos = terminos
      .filter(t => t.conversiones === 0 && t.gasto >= TERMINO_GASTO_MIN)
      .sort((a, b) => b.gasto - a.gasto)
    const total = malos.reduce((s, t) => s + t.gasto, 0)
    return {
      total,
      lineas: malos.slice(0, TERMINOS_EN_INFORME).map(t =>
        `· "${t.termino}" — ${fmt(t.gasto)}, ${t.clicks} clic${t.clicks === 1 ? '' : 's'}, 0 conv. (${t.campana.replace('Búsqueda - ', '')})`),
    }
  } catch (e) {
    console.warn('[gads-vigilancia] términos:', e)
    return { lineas: [], total: 0 }
  }
}

/** Arma el texto del informe semanal (lunes). */
export async function armarInformeSemanal(): Promise<string> {
  const hace7d = new Date(Date.now() - 7 * 86_400_000).toISOString()
  // El seguimiento se mide a 90 días, no a 7: con ~46 fichas al mes y un 10% de
  // control, una semana no alcanza ni para dos leads en el grupo de control.
  const hace90d = new Date(Date.now() - 90 * 86_400_000).toISOString()
  const [resumen, rentab, hallazgos, quema, atribucion, lift] = await Promise.all([
    resumenCampanas('last_7d'),
    calcularRentabilidad('last_7d').catch(() => null),
    auditarCuenta().catch(() => [] as Hallazgo[]),
    terminosQueQuemanPlata(),
    resumenAtribucion(hace7d),
    medirLiftSeguimiento(hace90d).catch(() => null),
  ])

  const c = resumen.cuenta
  const partes: string[] = []
  partes.push('📊 *Google Ads — informe semanal*')

  // Semana vs semana anterior
  let vs = ''
  if (resumen.comparacion && resumen.comparacion.gasto > 0) {
    const dGasto = Math.round(((c.gasto - resumen.comparacion.gasto) / resumen.comparacion.gasto) * 100)
    const dConv = resumen.comparacion.conversiones > 0
      ? Math.round(((c.conversiones - resumen.comparacion.conversiones) / resumen.comparacion.conversiones) * 100)
      : null
    vs = ` (${dGasto >= 0 ? '+' : ''}${dGasto}% gasto${dConv != null ? `, ${dConv >= 0 ? '+' : ''}${dConv}% conv.` : ''} vs semana previa)`
  }
  partes.push(`Semana: ${fmt(c.gasto)} · ${c.clicks} clics · ${c.conversiones} conv. plataforma · CPA plat. ${fmt(c.costoPorConversion)}${vs}`)

  for (const camp of resumen.campanas.filter(x => x.status === 'ENABLED')) {
    const is = camp.impressionShare != null ? ` · IS ${camp.impressionShare}%` : ''
    const perd = camp.perdidoPorPresupuesto != null && camp.perdidoPorPresupuesto >= 10
      ? ` · pierde ${camp.perdidoPorPresupuesto}% por presupuesto` : ''
    partes.push(`• ${camp.nombre}: ${fmt(camp.gasto)} · ${camp.conversiones} conv.${is}${perd}`)
  }

  if (rentab) {
    partes.push(`\n💰 *Negocio real (7d):* ${rentab.leadsWhatsapp ?? '—'} leads · ${rentab.fichasDirectas} fichas → ${fmt(rentab.ingresosDirectos)}` +
      `${rentab.cplReal != null ? ` · CPL ${fmt(rentab.cplReal)}` : ''}${rentab.roasBlended != null ? ` · ROAS ${rentab.roasBlended.toFixed(1)}x` : ''}`)
  }

  // Atribución real clic → ficha (solo aparece cuando ya hay datos que mostrar).
  if (atribucion && atribucion.clics > 0) {
    partes.push(`\n🔗 *Atribución (7d):* ${atribucion.clics} clics de anuncio medidos · ` +
      `${atribucion.conTelefono} escribieron por WhatsApp · ${atribucion.conFicha} terminaron en ficha`)
  }

  // Seguimiento de leads contra su grupo de control. Solo se muestra cuando el
  // control tiene tamaño suficiente para que la comparación signifique algo: con
  // 3 leads de control, la diferencia es ruido y publicarla invita a decidir mal.
  if (lift && lift.control >= 10 && lift.tratados >= 10) {
    const pct = (a: number, b: number) => `${Math.round((a / b) * 100)}%`
    partes.push(`\n📨 *Seguimiento de leads (90d):* con mensaje ${lift.tratadosConFicha}/${lift.tratados} (${pct(lift.tratadosConFicha, lift.tratados)}) · ` +
      `sin mensaje ${lift.controlConFicha}/${lift.control} (${pct(lift.controlConFicha, lift.control)})` +
      `${lift.liftPuntos != null ? ` → ${lift.liftPuntos >= 0 ? '+' : ''}${lift.liftPuntos} pts` : ''}`)
  }

  if (quema.lineas.length) {
    partes.push(`\n🔥 *Términos que gastaron sin convertir (${fmt(quema.total)} en 7d):*`)
    for (const l of quema.lineas) partes.push(l)
    partes.push('Dime cuáles negativizo.')
  }

  const relevantes = [...hallazgos.filter(h => h.severidad === 'alta'), ...hallazgos.filter(h => h.severidad === 'media')].slice(0, 5)
  if (relevantes.length) {
    partes.push(`\n🔎 *Hallazgos de la auditoría (top ${relevantes.length}):*`)
    for (const h of relevantes) partes.push(lineaHallazgo(h))
    partes.push('\nDime cuáles aplico (o pídelo en el panel de Ads).')
  } else {
    partes.push('\n✅ La auditoría automática no encontró hallazgos relevantes esta semana.')
  }

  let texto = partes.join('\n')
  if (texto.length > 3800) texto = texto.slice(0, 3780) + '\n… (recortado)'
  return texto
}

/**
 * Punto de entrada del cron diario. Corre la guardia todos los días (solo avisa si hay
 * algo) y el informe completo los lunes. `enviar:false` = dry-run (no manda WhatsApp).
 */
export async function vigilanciaGoogleAds(opts: { enviar?: boolean } = {}): Promise<ResultadoVigilancia> {
  const enviar = opts.enviar !== false
  const out: ResultadoVigilancia = {
    guardia: { hallazgos: 0, enviado: false, mensaje: null },
    informe: { corresponde: esLunesChile(), enviado: false, mensaje: null },
  }
  if (String(process.env.GADS_VIGILANCIA ?? 'true').toLowerCase() === 'false') return out
  if (!isGoogleAdsConfigurado()) return out

  // Guardia diaria (silenciosa si no hay nada).
  const lineas = await chequeosGuardia()
  out.guardia.hallazgos = lineas.length
  if (lineas.length) {
    out.guardia.mensaje = `⚠️ *Google Ads — guardia diaria*\n${lineas.join('\n')}`
    if (enviar && isWhatsappConfigured()) {
      try { await avisarAdminsWhatsapp(out.guardia.mensaje); out.guardia.enviado = true }
      catch (e) { console.warn('[gads-vigilancia] no se pudo avisar guardia:', e) }
    }
  }

  // Informe semanal (lunes).
  if (out.informe.corresponde) {
    try {
      out.informe.mensaje = await armarInformeSemanal()
      if (enviar && isWhatsappConfigured()) {
        await avisarAdminsWhatsapp(out.informe.mensaje)
        out.informe.enviado = true
      }
    } catch (e) { console.warn('[gads-vigilancia] informe semanal:', e) }
  }

  return out
}
