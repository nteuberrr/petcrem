/**
 * Auditoría automática de la cuenta de Google Ads (Fase B del plan). Corre los checks
 * basados en las guías destiladas (lib/google-ads-guia.ts) + lo detectado en la
 * auditoría real del 2026-07-07 (scripts/audit-gads-quick.ts, semilla de esto) y
 * devuelve hallazgos con severidad y $ estimado recuperable/en juego.
 *
 * Best-effort: cada check se ejecuta de forma independiente y si falla se omite (no
 * tira abajo el resto de la auditoría). Los $ son ESTIMADOS, no exactos.
 */

import {
  resumenCampanas, listarCampanasGestion, listarKeywordsConQS, impressionShareCampanas,
  listarConversionActions, listarAds, contarAssets, contarNegativas, campanasConBidding,
} from './google-ads'

export interface Hallazgo {
  id: string
  severidad: 'alta' | 'media' | 'baja'
  area: string
  titulo: string
  detalle: string
  accionSugerida: string
  dolaresEstimados?: number
}

// Heurística de keywords "basura" (broad genéricas / informacionales / geo mal) — ver GUIA_GADS_NEGATIVAS/TERMINOS.
const PATRON_KEYWORD_BASURA = /^(cuanto|valor|coste|costo|vacuna|sale|happy|opiniones|requisitos|cuando|consiste|sufre|medicamento|medicamentos|argentina|peru|dolorosa)$/i

// Estrategias que NO siguen el playbook (ver GUIA_GADS_BIDDING) cuando ya hay conversiones.
const ESTRATEGIAS_FUERA_DE_PLAYBOOK = new Set(['TARGET_SPEND', 'MANUAL_CPC', 'ENHANCED_CPC'])

async function checkBidding(): Promise<Hallazgo[]> {
  const campanas = await campanasConBidding('last_30d')
  const out: Hallazgo[] = []
  for (const c of campanas) {
    if (ESTRATEGIAS_FUERA_DE_PLAYBOOK.has(c.biddingStrategyType)) {
      out.push({
        id: `bidding-fuera-playbook-${c.id}`,
        severidad: c.conversiones > 0 ? 'alta' : 'media',
        area: 'Bidding',
        titulo: `"${c.nombre}" usa ${c.biddingStrategyType} en vez de Maximizar Conversiones`,
        detalle: `${c.conversiones} conversiones y $${c.gasto.toLocaleString('es-CL')} de gasto en 30 días con esta estrategia.`,
        accionSugerida: c.conversiones >= 30
          ? 'Cambiar a Maximizar Conversiones + tCPA (ya hay suficiente historial de conversiones — ver GUIA_GADS_BIDDING).'
          : 'Cambiar a Maximizar Conversiones sin tCPA objetivo (día 1 del playbook) para que el algoritmo empiece a aprender con datos reales.',
      })
    }
  }
  return out
}

async function checkValoresConversion(): Promise<Hallazgo[]> {
  const acciones = await listarConversionActions()
  const primarias = acciones.filter(a => a.primaryForGoal)
  if (primarias.length < 2) return []
  const valores = primarias.map(a => a.valorDefault ?? 0).filter(v => v > 0)
  if (valores.length < 2) {
    return [{
      id: 'valores-conversion-faltantes',
      severidad: 'alta',
      area: 'Conversiones',
      titulo: 'Hay acciones de conversión primarias sin valor asignado',
      detalle: `${primarias.filter(a => !(a.valorDefault && a.valorDefault > 0)).map(a => a.nombre).join(', ')}.`,
      accionSugerida: 'Asignar un valor a cada acción (valor de lead = ticket promedio × tasa de cierre — preguntar al dueño, nunca inventar).',
    }]
  }
  const max = Math.max(...valores)
  const min = Math.min(...valores)
  if (max / min >= 10) {
    const baratas = primarias.filter(a => (a.valorDefault ?? 0) === min).map(a => a.nombre)
    const caras = primarias.filter(a => (a.valorDefault ?? 0) === max).map(a => a.nombre)
    return [{
      id: 'valores-conversion-incoherentes',
      severidad: 'alta',
      area: 'Conversiones',
      titulo: 'Valores de conversión muy desparejos entre acciones primarias',
      detalle: `"${baratas.join(', ')}" vale(n) $${min.toLocaleString('es-CL')} mientras "${caras.join(', ')}" vale(n) $${max.toLocaleString('es-CL')} (${Math.round(max / min)}x de diferencia). Esto distorsiona el Smart Bidding: optimiza hacia la acción "más valiosa" aunque en la realidad ambas sean leads igual de buenos.`,
      accionSugerida: 'Igualar los valores por tipo de interacción real (llamada, chat, formulario) usando el mismo criterio de ticket×cierre para todas.',
    }]
  }
  return []
}

async function checkRSAs(): Promise<Hallazgo[]> {
  const ads = await listarAds()
  const out: Hallazgo[] = []
  const incompletos = ads.filter(a => a.headlines < 15)
  if (incompletos.length > 0) {
    out.push({
      id: 'rsa-headlines-incompletos',
      severidad: 'media',
      area: 'Anuncios',
      titulo: `${incompletos.length} anuncio(s) con menos de 15 titulares`,
      detalle: incompletos.map(a => `${a.campana}/${a.grupoAnuncio}: ${a.headlines} titulares`).join(' · '),
      accionSugerida: 'Completar hasta 15 titulares cubriendo los 6 ángulos (ver GUIA_GADS_RSA) — Google testea más combinaciones y sube el CTR ~6%.',
    })
  }
  const sinPin = ads.filter(a => a.headlinesPinned === 0)
  if (sinPin.length > 0) {
    out.push({
      id: 'rsa-sin-pinning',
      severidad: 'media',
      area: 'Anuncios',
      titulo: `${sinPin.length} anuncio(s) sin ningún titular pinneado`,
      detalle: sinPin.map(a => `${a.campana}/${a.grupoAnuncio}`).join(' · '),
      accionSugerida: 'Pinnear 3 variantes de la keyword en la posición 1 (nunca en la 2) — asegura relevancia de anuncio y sube Quality Score.',
    })
  }
  const home = ads.filter(a => a.finalUrl && /\/?$/.test(a.finalUrl) && !a.finalUrl.split('/').slice(3).join('/'))
  if (home.length > 0) {
    out.push({
      id: 'rsa-apunta-a-home',
      severidad: 'alta',
      area: 'Anuncios',
      titulo: `${home.length} anuncio(s) apuntan a la página de inicio, no a una landing dedicada`,
      detalle: home.map(a => `${a.campana}: ${a.finalUrl}`).join(' · '),
      accionSugerida: 'Landing dedicada por keyword (H1 = keyword exacta) sube Quality Score vía Landing Page Experience — parte de la migración del sitio (tanda 2).',
    })
  }
  const noExcelente = ads.filter(a => a.adStrength && a.adStrength !== 'EXCELLENT' && a.adStrength !== 's/d')
  if (noExcelente.length > 0) {
    out.push({
      id: 'rsa-ad-strength',
      severidad: 'baja',
      area: 'Anuncios',
      titulo: `${noExcelente.length} anuncio(s) con Ad Strength por debajo de "Excelente"`,
      detalle: noExcelente.map(a => `${a.campana}/${a.grupoAnuncio}: ${a.adStrength}`).join(' · '),
      accionSugerida: 'Ad Strength "Excelente" correlaciona con ~15% más clics/conversiones — variar más los ángulos de titulares y descripciones.',
    })
  }
  return out
}

async function checkAssets(): Promise<Hallazgo[]> {
  const a = await contarAssets()
  const out: Hallazgo[] = []
  if (a.callouts < 8) {
    out.push({
      id: 'assets-callouts-pocos',
      severidad: 'media',
      area: 'Recursos',
      titulo: `Solo ${a.callouts} callouts activos (recomendado 8-12)`,
      detalle: 'Los callouts suman +5-15% de CTR y no cuestan nada extra por impresión/clic.',
      accionSugerida: 'Sumar callouts diferenciados hasta 8-12, cubriendo velocidad/confianza/valor/garantía (ver GUIA_GADS_ASSETS).',
    })
  }
  if (a.snippets < 2) {
    out.push({
      id: 'assets-snippets-pocos',
      severidad: 'baja',
      area: 'Recursos',
      titulo: `Solo ${a.snippets} snippets estructurados (recomendado 2 headers)`,
      detalle: 'Un segundo header (ej. "Servicios" + "Cobertura") duplica la superficie que Google puede mostrar.',
      accionSugerida: 'Agregar un segundo header de snippets con 4-10 valores verificables en la landing.',
    })
  }
  if (a.sitelinks < 4) {
    out.push({
      id: 'assets-sitelinks-pocos',
      severidad: 'media',
      area: 'Recursos',
      titulo: `Solo ${a.sitelinks} sitelinks activos (recomendado 4-8)`,
      detalle: 'Es el recurso de mayor impacto individual en CTR (+10-15%).',
      accionSugerida: 'Sumar sitelinks a páginas específicas y distintas (nunca "Ver más" genérico).',
    })
  }
  return out
}

async function checkKeywordsBasura(): Promise<Hallazgo[]> {
  const { keywords } = await listarKeywordsConQS('last_30d')
  // enVivo (no solo status propio): una keyword ENABLED de una campaña PAUSADA no está
  // gastando de verdad — contarla como "activa" infla el hallazgo con falsos positivos.
  const activas = keywords.filter(k => k.enVivo)
  const basura = activas.filter(k => PATRON_KEYWORD_BASURA.test(k.texto.trim()))
  if (basura.length === 0) return []
  const gastoTotal = basura.reduce((s, k) => s + k.gasto, 0)
  return [{
    id: 'keywords-basura',
    severidad: 'alta',
    area: 'Keywords',
    titulo: `${basura.length} keyword(s) genéricas/informacionales activas`,
    detalle: basura.map(k => `"${k.texto}" (${k.campana}, $${k.gasto.toLocaleString('es-CL')})`).join(' · '),
    accionSugerida: 'Pausar estas keywords — son términos de una palabra sin intención clara de compra o con geografía fuera de cobertura.',
    dolaresEstimados: gastoTotal > 0 ? gastoTotal : undefined,
  }]
}

async function checkImpressionShare(): Promise<Hallazgo[]> {
  const is = await impressionShareCampanas('last_30d')
  const out: Hallazgo[] = []
  for (const c of is) {
    if (c.perdidoPorPresupuesto != null && c.perdidoPorPresupuesto > 10) {
      const recuperable = c.gasto > 0 ? Math.round(c.gasto * (c.perdidoPorPresupuesto / 100)) : undefined
      out.push({
        id: `is-presupuesto-${c.id}`,
        severidad: 'alta',
        area: 'Presupuesto',
        titulo: `"${c.nombre}" pierde ${c.perdidoPorPresupuesto}% de impresiones por presupuesto`,
        detalle: `Impression Share actual: ${c.impressionShare ?? 's/d'}%. Está dejando de mostrarse por falta de presupuesto diario, no por competencia.`,
        accionSugerida: `Subir el presupuesto diario de "${c.nombre}" — hay demanda que hoy no se está capturando.`,
        dolaresEstimados: recuperable,
      })
    }
    if (c.perdidoPorRanking != null && c.perdidoPorRanking > 30) {
      out.push({
        id: `is-ranking-${c.id}`,
        severidad: 'media',
        area: 'Ranking',
        titulo: `"${c.nombre}" pierde ${c.perdidoPorRanking}% de impresiones por ranking (Quality Score/puja)`,
        detalle: `Impression Share actual: ${c.impressionShare ?? 's/d'}%.`,
        accionSugerida: 'Subir Quality Score (ver GUIA_GADS_QS): revisar relevancia del anuncio y, sobre todo, la landing page — es la palanca de mayor impacto acá (tanda 2: landing dedicada).',
      })
    }
  }
  return out
}

async function checkConfig(): Promise<Hallazgo[]> {
  const n = await contarNegativas()
  if (n.listasCompartidas === 0 && n.campana > 0) {
    return [{
      id: 'sin-listas-compartidas',
      severidad: 'media',
      area: 'Negativas',
      titulo: `${n.campana} negativas a nivel campaña pero 0 listas compartidas`,
      detalle: 'Toda negativa universal (empleo, DIY, informacional) hoy hay que agregarla campaña por campaña.',
      accionSugerida: 'Crear la lista compartida universal ES-CL (botón "Crear lista universal ES-CL" en el panel, o pedirle al agente "creá la lista de negativas universal") — aplica de una a todas las campañas.',
    }]
  }
  return []
}

async function checkHigiene(): Promise<Hallazgo[]> {
  const { campanas } = await resumenCampanas('last_30d')
  const { campanas: gestion } = await listarCampanasGestion()
  const activasSinGasto = gestion.filter(g => g.status === 'ENABLED' && !campanas.some(c => c.id === g.id && c.gasto > 0))
  if (activasSinGasto.length === 0) return []
  return [{
    id: 'campanas-activas-sin-gasto',
    severidad: 'baja',
    area: 'Higiene',
    titulo: `${activasSinGasto.length} campaña(s) activa(s) sin gasto en 30 días`,
    detalle: activasSinGasto.map(c => c.nombre).join(', '),
    accionSugerida: 'Revisar por qué no gastan (presupuesto en $0, sin keywords activas, geo mal configurada) o pausarlas si no aplican.',
  }]
}

const SEVERIDAD_PESO: Record<Hallazgo['severidad'], number> = { alta: 2, media: 1, baja: 0 }

export async function auditarCuenta(): Promise<Hallazgo[]> {
  const resultados = await Promise.allSettled([
    checkBidding(),
    checkValoresConversion(),
    checkRSAs(),
    checkAssets(),
    checkKeywordsBasura(),
    checkImpressionShare(),
    checkConfig(),
    checkHigiene(),
  ])
  const hallazgos = resultados.flatMap(r => r.status === 'fulfilled' ? r.value : [])
  return hallazgos.sort((a, b) => {
    const dSev = SEVERIDAD_PESO[b.severidad] - SEVERIDAD_PESO[a.severidad]
    if (dSev !== 0) return dSev
    return (b.dolaresEstimados ?? 0) - (a.dolaresEstimados ?? 0)
  })
}
