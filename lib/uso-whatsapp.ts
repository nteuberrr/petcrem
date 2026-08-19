import { getSupabase, isSupabaseConfigured } from './supabase'

/**
 * REGISTRO DE ENVÍOS DE WHATSAPP — cuántos mensajes salen y de qué FLUJO.
 *
 * Por qué existe (revisión de costos, 19-08-2026): el consumo de IA estaba medido
 * al detalle y el de WhatsApp era un punto ciego. Meta sí sabe cuánto nos cobra
 * —y ese número se lee tal cual en lib/whatsapp-costos— pero solo lo desglosa por
 * CATEGORÍA (utility / marketing / service). Con eso no se puede responder la
 * pregunta que importa: *qué parte del sistema* está gastando. Esta tabla aporta
 * esa dimensión; el dinero sigue saliendo de Meta.
 *
 * Lo que se guarda es el ENVÍO, no la entrega: `ok` es lo que respondió la API en
 * el momento. Meta acepta con 200 mensajes que después no entrega (incidente del
 * 11-08-2026, cuenta bloqueada por el método de pago), así que el estado real
 * viaja aparte por webhook y se cruza con `provider_message_id`.
 *
 * ⚠️ Los mensajes de SERVICE (texto libre dentro de la ventana de 24 h) hoy son
 * GRATIS, y son la inmensa mayoría. Meta vuelve a cobrarlos el 1 de octubre de
 * 2026: por eso se registran igual, para saber de antemano con qué volumen nos
 * agarra ese cambio.
 *
 * Best-effort: si Supabase no está o el insert falla, se ignora en silencio.
 * Registrar el gasto nunca puede tumbar un mensaje al cliente.
 */

const TABLE = 'uso_whatsapp'

/** Categoría de cobro de Meta. SERVICE = texto libre dentro de la ventana de 24 h. */
export type CategoriaWa = 'SERVICE' | 'UTILITY' | 'MARKETING' | 'AUTHENTICATION'

export interface EnvioWaLog {
  /** texto | plantilla | interactivo | media */
  tipo: string
  /** Nombre de la plantilla, si fue una. */
  plantilla?: string
  categoria: CategoriaWa
  /** Teléfono destino, solo dígitos. */
  destino: string
  ok: boolean
  error?: string
  provider_message_id?: string
}

function hoyChileISO(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

export async function registrarEnvioWa(e: EnvioWaLog): Promise<void> {
  if (!isSupabaseConfigured()) return
  try {
    const { error } = await getSupabase().from(TABLE).insert({
      fecha: hoyChileISO(),
      ts: new Date().toISOString(),
      tipo: e.tipo || '',
      plantilla: e.plantilla || '',
      categoria: e.categoria,
      destino: (e.destino || '').replace(/\D/g, '').slice(-11),
      ok: !!e.ok,
      error: String(e.error || '').slice(0, 300),
      provider_message_id: e.provider_message_id || '',
    })
    if (error) console.warn('[uso-whatsapp] insert:', error.message)
  } catch (err) {
    console.warn('[uso-whatsapp]', err instanceof Error ? err.message : String(err))
  }
}

// ─── Lectura (panel) ─────────────────────────────────────────────────────────

export interface ResumenWa {
  dias: number
  desde: string
  total: number
  fallidos: number
  /** Volumen por categoría de cobro. */
  porCategoria: Array<{ categoria: string; n: number }>
  /** Volumen por plantilla (solo las que se cobran). */
  porPlantilla: Array<{ plantilla: string; categoria: string; n: number }>
  /** Volumen por día, para ver la tendencia. */
  porDia: Array<{ fecha: string; cobrables: number; gratis: number }>
}

function desdeISO(dias: number): string {
  const d = new Date(Date.now() - dias * 86400_000)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

export async function resumenEnviosWa(dias = 30): Promise<ResumenWa> {
  const desde = desdeISO(dias)
  const vacio: ResumenWa = { dias, desde, total: 0, fallidos: 0, porCategoria: [], porPlantilla: [], porDia: [] }
  if (!isSupabaseConfigured()) return vacio

  const filas: Array<Record<string, unknown>> = []
  try {
    for (let off = 0; ; off += 1000) {
      const { data, error } = await getSupabase().from(TABLE)
        .select('fecha, tipo, plantilla, categoria, ok')
        .gte('fecha', desde).order('id', { ascending: true }).range(off, off + 999)
      if (error) throw new Error(error.message)
      const lote = data ?? []
      filas.push(...lote)
      if (lote.length < 1000) break
    }
  } catch (e) {
    console.warn('[uso-whatsapp] resumen:', e instanceof Error ? e.message : String(e))
    return vacio
  }

  const cat = new Map<string, number>()
  const tpl = new Map<string, { categoria: string; n: number }>()
  const dia = new Map<string, { cobrables: number; gratis: number }>()
  let fallidos = 0

  for (const f of filas) {
    const categoria = String(f.categoria || 'SERVICE')
    const fecha = String(f.fecha || '')
    if (!f.ok) fallidos++
    cat.set(categoria, (cat.get(categoria) ?? 0) + 1)
    const nombre = String(f.plantilla || '')
    if (nombre) {
      const prev = tpl.get(nombre) ?? { categoria, n: 0 }
      tpl.set(nombre, { categoria, n: prev.n + 1 })
    }
    const d = dia.get(fecha) ?? { cobrables: 0, gratis: 0 }
    if (categoria === 'SERVICE') d.gratis++
    else d.cobrables++
    dia.set(fecha, d)
  }

  return {
    dias, desde,
    total: filas.length,
    fallidos,
    porCategoria: [...cat].map(([categoria, n]) => ({ categoria, n })).sort((a, b) => b.n - a.n),
    porPlantilla: [...tpl].map(([plantilla, v]) => ({ plantilla, ...v })).sort((a, b) => b.n - a.n),
    porDia: [...dia].map(([fecha, v]) => ({ fecha, ...v })).sort((a, b) => a.fecha.localeCompare(b.fecha)),
  }
}
