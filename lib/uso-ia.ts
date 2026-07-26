import type Anthropic from '@anthropic-ai/sdk'
import { getSupabase, isSupabaseConfigured } from './supabase'

/**
 * REGISTRO DE CONSUMO DE IA — qué se gasta, en qué módulo y con qué modelo.
 *
 * Cada llamada a un modelo (Claude) o a un generador de imagen/video (Gemini)
 * deja una fila en `uso_ia` con los tokens y el costo estimado en USD. Sin esto
 * el gasto solo se ve agregado en la consola del proveedor, sin saber QUÉ parte
 * del sistema lo produjo.
 *
 * El costo es una ESTIMACIÓN calculada con la tabla de precios de abajo: sirve
 * para comparar módulos y ver la tendencia, no para cuadrar la factura. La cifra
 * oficial siempre es la del proveedor.
 *
 * TODO es best-effort: si Supabase no está o el insert falla, se ignora en
 * silencio. Registrar el gasto nunca puede tumbar una respuesta al cliente.
 */

const TABLE = 'uso_ia'

/** Módulos que consumen IA. Sirven para agrupar el gasto en el panel. */
export type ModuloIA =
  | 'bot-inbox'            // agente de WhatsApp/Instagram (el de mayor volumen)
  | 'bot-seguimiento'      // barrido de leads tibios
  | 'bot-relay'            // relay de ETA de retiro
  | 'bot-calibracion'      // análisis de transcripciones
  | 'marketing-chat'       // agente de marketing (interactivo)
  | 'marketing-autopiloto' // planificación semanal
  | 'marketing-pieza'      // generación/edición de piezas sociales
  | 'mailing-generador'    // campañas de correo con IA
  | 'imagen'               // Gemini / Nano Banana
  | 'video'                // Veo

export const MODULOS_IA: Array<{ key: ModuloIA; label: string }> = [
  { key: 'bot-inbox', label: 'Bot del inbox' },
  { key: 'bot-seguimiento', label: 'Seguimiento de leads' },
  { key: 'bot-relay', label: 'Relay de retiro' },
  { key: 'bot-calibracion', label: 'Calibración del bot' },
  { key: 'marketing-chat', label: 'Agente de marketing' },
  { key: 'marketing-autopiloto', label: 'Autopiloto de marketing' },
  { key: 'marketing-pieza', label: 'Piezas sociales' },
  { key: 'mailing-generador', label: 'Campañas de correo' },
  { key: 'imagen', label: 'Imágenes' },
  { key: 'video', label: 'Videos' },
]

export function labelModulo(key: string): string {
  return MODULOS_IA.find(m => m.key === key)?.label || key || '(sin módulo)'
}

// ─── Precios de referencia ───────────────────────────────────────────────────
// USD por MILLÓN de tokens. Actualizar si el proveedor cambia la lista.
// No contempla el recargo por contexto >200k (ninguna llamada del sistema se
// acerca) ni descuentos por batch.
interface PrecioModelo {
  entrada: number
  salida: number
  /** Escritura de caché de 5 minutos (1,25× la entrada). */
  cache5m: number
  /** Escritura de caché de 1 hora (2× la entrada). */
  cache1h: number
  /** Lectura de caché (0,1× la entrada). */
  cacheLectura: number
}

const PRECIOS: Array<{ re: RegExp; p: PrecioModelo }> = [
  { re: /opus/i, p: { entrada: 5, salida: 25, cache5m: 6.25, cache1h: 10, cacheLectura: 0.5 } },
  { re: /haiku/i, p: { entrada: 1, salida: 5, cache5m: 1.25, cache1h: 2, cacheLectura: 0.1 } },
  // Sonnet y cualquier otro no reconocido: se asume Sonnet (el más usado acá).
  { re: /./, p: { entrada: 3, salida: 15, cache5m: 3.75, cache1h: 6, cacheLectura: 0.3 } },
]

function precioDe(modelo: string): PrecioModelo {
  return (PRECIOS.find(x => x.re.test(modelo || '')) as { p: PrecioModelo }).p
}

/** Costo fijo por unidad generada (USD), para lo que no se cobra por token. */
const PRECIO_IMAGEN: Array<{ re: RegExp; usd: number }> = [
  { re: /gemini-3-pro-image/i, usd: 0.134 },
  { re: /flash-image/i, usd: 0.039 },
  { re: /./, usd: 0.04 },
]
/** Video: USD por SEGUNDO de clip. */
const PRECIO_VIDEO_SEG: Array<{ re: RegExp; usd: number }> = [
  { re: /lite/i, usd: 0.10 },
  { re: /fast/i, usd: 0.15 },
  { re: /./, usd: 0.40 },
]

export function costoImagen(modelo: string): number {
  return (PRECIO_IMAGEN.find(x => x.re.test(modelo || '')) as { usd: number }).usd
}
export function costoVideo(modelo: string, segundos: number): number {
  return (PRECIO_VIDEO_SEG.find(x => x.re.test(modelo || '')) as { usd: number }).usd * (segundos || 8)
}

// ─── Escritura ───────────────────────────────────────────────────────────────

function hoyChileISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

async function insertar(fila: Record<string, unknown>): Promise<void> {
  if (!isSupabaseConfigured()) return
  try {
    const { error } = await getSupabase().from(TABLE).insert(fila)
    if (error) console.warn('[uso-ia] insert:', error.message)
  } catch (e) {
    console.warn('[uso-ia]', e instanceof Error ? e.message : String(e))
  }
}

/**
 * Registra el consumo de UNA llamada a Claude. Pasar el `usage` que devuelve la
 * API tal cual. `detalle` es opcional (p. ej. el id de la pieza generada).
 */
export async function registrarUso(
  modulo: ModuloIA,
  modelo: string,
  usage: Anthropic.Usage | undefined | null,
  detalle = '',
): Promise<void> {
  if (!usage) return
  const entrada = usage.input_tokens || 0
  const salida = usage.output_tokens || 0
  const lectura = usage.cache_read_input_tokens || 0
  // El desglose 5m/1h solo viene en `cache_creation`; si no está, se asume 5m.
  const w1h = usage.cache_creation?.ephemeral_1h_input_tokens || 0
  const w5m = usage.cache_creation?.ephemeral_5m_input_tokens
    ?? Math.max(0, (usage.cache_creation_input_tokens || 0) - w1h)
  const p = precioDe(modelo)
  const costo = (entrada * p.entrada + salida * p.salida + lectura * p.cacheLectura + w5m * p.cache5m + w1h * p.cache1h) / 1_000_000

  await insertar({
    fecha: hoyChileISO(),
    ts: new Date().toISOString(),
    modulo,
    modelo: modelo || '',
    entrada,
    salida,
    cache_lectura: lectura,
    cache_escritura: w5m + w1h,
    costo_usd: Math.round(costo * 1e6) / 1e6,
    detalle: String(detalle || '').slice(0, 200),
  })
}

/** Registra un consumo de costo fijo (imágenes, videos): no se cobra por token. */
export async function registrarUsoFijo(
  modulo: ModuloIA,
  modelo: string,
  costoUsd: number,
  detalle = '',
): Promise<void> {
  await insertar({
    fecha: hoyChileISO(),
    ts: new Date().toISOString(),
    modulo,
    modelo: modelo || '',
    entrada: 0,
    salida: 0,
    cache_lectura: 0,
    cache_escritura: 0,
    costo_usd: Math.round((costoUsd || 0) * 1e6) / 1e6,
    detalle: String(detalle || '').slice(0, 200),
  })
}

// ─── Lectura (panel) ─────────────────────────────────────────────────────────

interface FilaUso {
  fecha: string
  modulo: string
  modelo: string
  entrada: number
  salida: number
  cache_lectura: number
  cache_escritura: number
  costo_usd: number
}

export interface ResumenUso {
  dias: number
  desde: string
  /** Total del período consultado. */
  totalUsd: number
  llamadas: number
  tokens: { entrada: number; salida: number; cacheLectura: number; cacheEscritura: number }
  /** Mes calendario en curso (Chile) + proyección lineal a fin de mes. */
  mes: { usd: number; llamadas: number; proyeccionUsd: number }
  porModulo: Array<{ modulo: string; label: string; usd: number; llamadas: number }>
  porModelo: Array<{ modelo: string; usd: number; llamadas: number }>
  porDia: Array<{ fecha: string; usd: number; llamadas: number }>
  /** true si se llegó al tope de filas leídas (el total sería mayor). */
  truncado: boolean
}

/** Lee las filas del período paginando (PostgREST corta en 1.000 por request). */
async function leerFilas(desde: string, maxFilas = 30_000): Promise<{ filas: FilaUso[]; truncado: boolean }> {
  const sb = getSupabase()
  const filas: FilaUso[] = []
  const PASO = 1000
  for (let off = 0; off < maxFilas; off += PASO) {
    const { data, error } = await sb.from(TABLE)
      .select('fecha,modulo,modelo,entrada,salida,cache_lectura,cache_escritura,costo_usd')
      .gte('fecha', desde)
      .order('id', { ascending: true })
      .range(off, off + PASO - 1)
    if (error) throw new Error(error.message)
    const lote = (data || []) as unknown as FilaUso[]
    filas.push(...lote)
    if (lote.length < PASO) return { filas, truncado: false }
  }
  return { filas, truncado: true }
}

function isoMenosDias(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

export async function resumenUso(dias = 30): Promise<ResumenUso> {
  const desde = isoMenosDias(Math.max(1, dias) - 1)
  const inicioMes = hoyChileISO().slice(0, 8) + '01'
  // Si el mes empezó antes que la ventana pedida, leemos desde el que sea menor
  // para poder calcular ambas cosas en una sola pasada.
  const { filas, truncado } = await leerFilas(desde < inicioMes ? desde : inicioMes)

  const acc = { usd: 0, llamadas: 0, entrada: 0, salida: 0, cacheLectura: 0, cacheEscritura: 0 }
  const mes = { usd: 0, llamadas: 0 }
  const porModulo = new Map<string, { usd: number; llamadas: number }>()
  const porModelo = new Map<string, { usd: number; llamadas: number }>()
  const porDia = new Map<string, { usd: number; llamadas: number }>()

  for (const f of filas) {
    const usd = Number(f.costo_usd) || 0
    if (f.fecha >= inicioMes) { mes.usd += usd; mes.llamadas++ }
    if (f.fecha < desde) continue
    acc.usd += usd
    acc.llamadas++
    acc.entrada += Number(f.entrada) || 0
    acc.salida += Number(f.salida) || 0
    acc.cacheLectura += Number(f.cache_lectura) || 0
    acc.cacheEscritura += Number(f.cache_escritura) || 0
    const m = porModulo.get(f.modulo) || { usd: 0, llamadas: 0 }
    m.usd += usd; m.llamadas++; porModulo.set(f.modulo, m)
    const mo = porModelo.get(f.modelo) || { usd: 0, llamadas: 0 }
    mo.usd += usd; mo.llamadas++; porModelo.set(f.modelo, mo)
    const d = porDia.get(f.fecha) || { usd: 0, llamadas: 0 }
    d.usd += usd; d.llamadas++; porDia.set(f.fecha, d)
  }

  // Proyección lineal: lo gastado en el mes ÷ días transcurridos × días del mes.
  const hoy = hoyChileISO()
  const diaDelMes = parseInt(hoy.slice(8, 10), 10) || 1
  const diasDelMes = new Date(parseInt(hoy.slice(0, 4), 10), parseInt(hoy.slice(5, 7), 10), 0).getDate()

  const r2 = (n: number) => Math.round(n * 100) / 100
  return {
    dias,
    desde,
    totalUsd: r2(acc.usd),
    llamadas: acc.llamadas,
    tokens: { entrada: acc.entrada, salida: acc.salida, cacheLectura: acc.cacheLectura, cacheEscritura: acc.cacheEscritura },
    mes: { usd: r2(mes.usd), llamadas: mes.llamadas, proyeccionUsd: r2((mes.usd / diaDelMes) * diasDelMes) },
    porModulo: [...porModulo.entries()]
      .map(([modulo, v]) => ({ modulo, label: labelModulo(modulo), usd: r2(v.usd), llamadas: v.llamadas }))
      .sort((a, b) => b.usd - a.usd),
    porModelo: [...porModelo.entries()]
      .map(([modelo, v]) => ({ modelo: modelo || '(sin modelo)', usd: r2(v.usd), llamadas: v.llamadas }))
      .sort((a, b) => b.usd - a.usd),
    porDia: [...porDia.entries()]
      .map(([fecha, v]) => ({ fecha, usd: r2(v.usd), llamadas: v.llamadas }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha)),
    truncado,
  }
}
