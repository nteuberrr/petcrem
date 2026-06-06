import { NextResponse } from 'next/server'
import { getTranscriptsParaCalibracion, updateAgenteConfig } from '@/lib/mensajes'
import { isAgenteConfigurado, calibrarDesdeTranscripts } from '@/lib/agente-mensajes'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST: corre una calibración del agente analizando con Claude una muestra de
 * conversaciones reales (históricas + nuevas) y guarda la guía resultante.
 */
export async function POST() {
  try {
    if (!isAgenteConfigurado()) {
      return NextResponse.json({ error: 'Falta ANTHROPIC_API_KEY para calibrar.' }, { status: 400 })
    }
    const transcripts = await getTranscriptsParaCalibracion()
    if (transcripts.length === 0) {
      return NextResponse.json({ error: 'Todavía no hay conversaciones con intercambio para analizar.' }, { status: 400 })
    }
    const calibracion = await calibrarDesdeTranscripts(transcripts)
    const cfg = await updateAgenteConfig({
      calibracion,
      calibracion_at: new Date().toISOString(),
      calibracion_muestra: transcripts.length,
    })
    return NextResponse.json(cfg)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
