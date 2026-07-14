import { getSupabase } from './supabase'

/**
 * BITÁCORA DE DECISIONES DE MARKETING (tabla marketing_decisiones, Supabase directo).
 *
 * Registro automático de toda ESCRITURA aprobada que ejecuta el agente de marketing
 * (Google Ads: pausas, presupuestos, negativas, RSAs, campañas; Meta: publicar pieza,
 * perfil). El chat recorta el historial a los últimos turnos, así que sin esto los
 * cambios aprobados se pierden: la bitácora es la memoria durable que permite (a) al
 * dueño auditar qué se hizo y por qué, y (b) al agente no atribuir una mejora al
 * cambio equivocado ("cambios recientes" del período, como pide toda auditoría seria).
 *
 * Best-effort: registrar NUNCA debe tirar abajo la acción ya ejecutada.
 */

export interface DecisionMarketing {
  id: number
  created_at: string
  area: string
  accion: string
  detalle: string
  motivo: string
  resultado: string
  aprobado_por: string
}

export interface NuevaDecision {
  /** google_ads | meta | contenido */
  area: string
  /** Nombre corto de la acción (ej. 'pausar_campana', 'presupuesto', 'crear_rsa'). */
  accion: string
  /** Qué cambió exactamente (campaña/keyword, antes → después, montos). */
  detalle: string
  /** Por qué se hizo (lo aporta el agente al ejecutar). */
  motivo?: string
  /** Resultado inmediato reportado por la herramienta. */
  resultado?: string
  /** Usuario del chat que confirmó. */
  aprobadoPor?: string
}

/** Registra una decisión ejecutada. Best-effort: loguea y sigue si falla. */
export async function registrarDecision(d: NuevaDecision): Promise<void> {
  try {
    const { error } = await getSupabase().from('marketing_decisiones').insert({
      area: d.area,
      accion: d.accion,
      detalle: (d.detalle || '').slice(0, 2000),
      motivo: (d.motivo || '').slice(0, 1000),
      resultado: (d.resultado || '').slice(0, 2000),
      aprobado_por: d.aprobadoPor || '',
    })
    if (error) console.error('[marketing-decisiones] no se pudo registrar:', error.message)
  } catch (e) {
    console.error('[marketing-decisiones] no se pudo registrar:', e)
  }
}

/** Lista las decisiones más recientes (para la tool del agente y la auditoría). */
export async function listarDecisiones(opts: { dias?: number; area?: string; limite?: number } = {}): Promise<DecisionMarketing[]> {
  const dias = Math.max(1, opts.dias ?? 30)
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString()
  let q = getSupabase()
    .from('marketing_decisiones')
    .select('*')
    .gte('created_at', desde)
    .order('created_at', { ascending: false })
    .limit(Math.min(100, Math.max(1, opts.limite ?? 40)))
  if (opts.area) q = q.eq('area', opts.area)
  const { data, error } = await q
  if (error) throw new Error(`[marketing-decisiones] ${error.message}`)
  return (data || []) as DecisionMarketing[]
}

/** Resumen en texto de los cambios recientes, para inyectar en reportes/auditorías. */
export function formatearDecisiones(decisiones: DecisionMarketing[]): string {
  if (decisiones.length === 0) return '(sin cambios registrados en el período)'
  return decisiones.map(d => {
    const fecha = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(d.created_at))
    return `- ${fecha} [${d.area}/${d.accion}]${d.aprobado_por ? ` (aprobó ${d.aprobado_por})` : ''}: ${d.detalle}${d.motivo ? ` — motivo: ${d.motivo}` : ''}`
  }).join('\n')
}
