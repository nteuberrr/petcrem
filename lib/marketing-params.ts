import { getSupabase } from './supabase'

/**
 * PARÁMETROS EDITABLES del marketing: lo CUANTITATIVO que depende de datos del
 * negocio (frecuencia de publicación, pilares editoriales y —para cuando se
 * activen ads— CPA/CPL/presupuesto). Se guardan como JSON en la columna
 * `marketing_config.parametros` (fila id=1), para ajustarlos SIN tocar código.
 *
 * Los defaults son referencias de la guía de contenido; los montos en CLP quedan
 * en `null` = "pendiente de que el dueño defina su número real". NADA en el
 * sistema debe hardcodear estos valores: se leen siempre con getMarketingParams().
 */

export interface PilarEditorial { key: string; label: string; pct: number }

export interface MarketingParams {
  // Publicación orgánica (las usa el planner para repartir el calendario).
  ig_posts_semana: number
  ig_carruseles_semana: number
  fb_posts_semana: number
  email_por_mes: number
  /** Horarios sugeridos de publicación (HH:MM). Placeholder: ajustar por Insights. */
  horarios_publicacion: string[]
  // Estrategia editorial.
  pilares: PilarEditorial[]
  /** Regla 80/20: tope de contenido de venta directa. */
  venta_directa_max_pct: number
  // Ads — NO activos aún. Pendientes de los números reales del dueño (null).
  cpa_objetivo_clp: number | null
  cpl_objetivo_clp: number | null
  presupuesto_mensual_clp: number | null
  reparto_pauta_pct: { google_search: number; meta_prospeccion: number; remarketing: number; testeo: number }
  // Autopiloto (Etapa 1): auto-genera el plan semanal para tu aprobación. NADA se
  // publica solo. Default OFF: no corre hasta que el dueño lo active desde la UI.
  autopiloto_activo: boolean
  /** Interno (no se edita en la UI): lunes (ISO) de la última semana planificada. */
  autopiloto_ultima_semana: string
}

export const DEFAULT_PARAMS: MarketingParams = {
  ig_posts_semana: 4,
  ig_carruseles_semana: 2,
  fb_posts_semana: 2,
  email_por_mes: 2,
  horarios_publicacion: ['13:00', '19:00'],
  pilares: [
    { key: 'educacion', label: 'Educación (tips, guías, cómo funciona)', pct: 35 },
    { key: 'prueba_social', label: 'Prueba social (testimonios, clínicas)', pct: 18 },
    { key: 'humanizacion', label: 'Detrás de escena / humanización', pct: 15 },
    { key: 'comunidad', label: 'Comunidad (homenajes, contenido compartible)', pct: 15 },
    { key: 'servicio', label: 'Servicio / oferta (convenio, productos)', pct: 12 },
    { key: 'valores', label: 'Cultura y valores', pct: 5 },
  ],
  venta_directa_max_pct: 20,
  cpa_objetivo_clp: null,
  cpl_objetivo_clp: null,
  presupuesto_mensual_clp: null,
  reparto_pauta_pct: { google_search: 45, meta_prospeccion: 32, remarketing: 13, testeo: 10 },
  autopiloto_activo: false,
  autopiloto_ultima_semana: '',
}

/** Lee los parámetros vigentes (defaults + overrides guardados en JSON). */
export async function getMarketingParams(): Promise<MarketingParams> {
  try {
    const { data, error } = await getSupabase()
      .from('marketing_config')
      .select('parametros')
      .eq('id', 1)
      .maybeSingle()
    if (error || !data?.parametros) return DEFAULT_PARAMS
    const raw = typeof data.parametros === 'string' ? JSON.parse(data.parametros) : data.parametros
    if (!raw || typeof raw !== 'object') return DEFAULT_PARAMS
    return {
      ...DEFAULT_PARAMS,
      ...raw,
      reparto_pauta_pct: { ...DEFAULT_PARAMS.reparto_pauta_pct, ...(raw.reparto_pauta_pct || {}) },
      pilares: Array.isArray(raw.pilares) && raw.pilares.length ? raw.pilares : DEFAULT_PARAMS.pilares,
    }
  } catch {
    return DEFAULT_PARAMS
  }
}

/** Guarda un patch de parámetros (merge sobre lo vigente). */
export async function updateMarketingParams(patch: Partial<MarketingParams>): Promise<void> {
  const actual = await getMarketingParams()
  const merged = { ...actual, ...patch }
  const { error } = await getSupabase()
    .from('marketing_config')
    .upsert({ id: 1, parametros: JSON.stringify(merged), updated_at: new Date().toISOString() }, { onConflict: 'id' })
  if (error) throw new Error(`[marketing-params] ${error.message}`)
}

/** Bloque de prompt con la cadencia y el mix vigentes (para el orquestador/planner). */
export function bloqueParametros(p: MarketingParams): string {
  const pilares = p.pilares.map(x => `${x.label}: ~${x.pct}%`).join('; ')
  const ads = p.presupuesto_mensual_clp
    ? `Presupuesto de pauta ~$${p.presupuesto_mensual_clp.toLocaleString('es-CL')}/mes; reparto Google Search ${p.reparto_pauta_pct.google_search}% · Meta prospección ${p.reparto_pauta_pct.meta_prospeccion}% · remarketing ${p.reparto_pauta_pct.remarketing}% · testeo ${p.reparto_pauta_pct.testeo}%.`
    : 'Pauta pagada: aún SIN presupuesto definido — no propongas gasto en ads hasta que el dueño fije un monto.'
  return `PARÁMETROS VIGENTES DEL PLAN (editables por el equipo; son la cadencia y el mix OPERATIVOS — respetalos al planificar y REEMPLAZAN cualquier cadencia genérica del guion):
- Frecuencia: Instagram ${p.ig_posts_semana} posts/semana (de esos ~${p.ig_carruseles_semana} carruseles), Facebook ${p.fb_posts_semana}/semana, email a veterinarios ${p.email_por_mes}/mes.
- Horarios sugeridos de publicación: ${p.horarios_publicacion.join(', ')} (ajustar por métricas propias).
- MIX de pilares editoriales (repartí el calendario según estos %): ${pilares}. Regla 80/20: MÁXIMO ${p.venta_directa_max_pct}% de venta directa; el resto entrega valor, emoción o comunidad.
- ${ads}`
}
