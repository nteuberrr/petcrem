import { getSupabase } from './supabase'

/**
 * Config editable del AGENTE DE MARKETING (tabla marketing_config, fila única
 * id=1). Espejo de agente_config del inbox: el equipo escribe el "playbook"
 * (instrucciones/datos vigentes) y una calibración opcional de estilo. Se lee
 * fresco en cada interacción del agente.
 */

export interface MarketingConfig {
  instrucciones: string
  calibracion: string
  updated_at: string | null
}

const DEFAULT: MarketingConfig = { instrucciones: '', calibracion: '', updated_at: null }

export async function getMarketingConfig(): Promise<MarketingConfig> {
  try {
    const { data, error } = await getSupabase()
      .from('marketing_config')
      .select('instrucciones,calibracion,updated_at')
      .eq('id', 1)
      .maybeSingle()
    if (error || !data) return DEFAULT
    return {
      instrucciones: data.instrucciones || '',
      calibracion: data.calibracion || '',
      updated_at: data.updated_at || null,
    }
  } catch {
    return DEFAULT
  }
}

export async function updateMarketingConfig(patch: Partial<Pick<MarketingConfig, 'instrucciones' | 'calibracion'>>): Promise<void> {
  const row: Record<string, unknown> = { id: 1, updated_at: new Date().toISOString() }
  if (patch.instrucciones !== undefined) row.instrucciones = patch.instrucciones
  if (patch.calibracion !== undefined) row.calibracion = patch.calibracion
  const { error } = await getSupabase().from('marketing_config').upsert(row, { onConflict: 'id' })
  if (error) throw new Error(`[marketing-config] ${error.message}`)
}
