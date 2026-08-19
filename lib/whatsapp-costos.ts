/**
 * LO QUE META NOS COBRA POR WHATSAPP — el número de verdad, no una estimación.
 *
 * A diferencia del consumo de IA (donde el costo se calcula con una lista de
 * precios propia, ver lib/uso-ia), acá Meta expone lo facturado: el campo
 * `pricing_analytics` de la WABA devuelve volumen y costo por día y por categoría,
 * en la moneda de facturación de la cuenta (para nosotros, pesos chilenos).
 *
 * ⚠️ Detalles que costaron un rato encontrar y conviene no volver a buscar:
 *  · Va contra **v23.0**. En v22 el campo se ignora en silencio: la respuesta
 *    llega 200 con solo `{id}` y parece que no hubiera datos.
 *  · `dimensions` es OBLIGATORIO. Sin él pasa lo mismo — 200 y nada adentro.
 *  · `conversation_analytics` (el endpoint viejo, por conversación) ya no
 *    devuelve nada: Meta cobra por MENSAJE desde 2025, no por conversación.
 *  · El token necesita `whatsapp_business_management`.
 *
 * Requiere `WHATSAPP_BUSINESS_ACCOUNT_ID`. Sin esa env no hay forma de preguntar:
 * el id del número (`WHATSAPP_PHONE_NUMBER_ID`) no sirve para esto.
 */

const GRAPH = 'https://graph.facebook.com'
/** Fijo: en v22 el campo pricing_analytics no existe todavía. */
const VERSION = 'v23.0'

export interface PuntoCosto {
  /** YYYY-MM-DD (día en UTC, tal como lo agrupa Meta). */
  fecha: string
  categoria: string
  mensajes: number
  costo: number
}

export interface CostosWhatsapp {
  ok: boolean
  error?: string
  /** Moneda de facturación de la WABA (CLP en nuestro caso). */
  moneda: string
  desde: string
  hasta: string
  puntos: PuntoCosto[]
  /** Agregado por categoría en todo el rango. */
  porCategoria: Array<{ categoria: string; mensajes: number; costo: number }>
  total: number
  /** Mensajes que hoy no se cobran (ventana de 24 h). Ver la nota de octubre. */
  gratis: number
}

const VACIO = (moneda = 'CLP'): CostosWhatsapp => ({
  ok: false, moneda, desde: '', hasta: '', puntos: [], porCategoria: [], total: 0, gratis: 0,
})

interface PuntoMeta { start?: number; end?: number; pricing_category?: string; volume?: number; cost?: number }

/**
 * Costo real del rango pedido. `dias` cuenta hacia atrás desde hoy.
 *
 * Best-effort: ante cualquier fallo devuelve `ok:false` con el motivo, para que el
 * panel pueda decir "no se pudo consultar" en vez de mostrar un cero que miente.
 */
export async function costosWhatsapp(dias = 30): Promise<CostosWhatsapp> {
  const token = process.env.WHATSAPP_TOKEN
  const waba = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID
  if (!token) return { ...VACIO(), error: 'WHATSAPP_TOKEN no configurado' }
  if (!waba) return { ...VACIO(), error: 'Falta WHATSAPP_BUSINESS_ACCOUNT_ID: sin ese id Meta no entrega el costo' }

  const hastaTs = Math.floor(Date.now() / 1000)
  const desdeTs = hastaTs - Math.max(1, dias) * 86400
  const field = `pricing_analytics.start(${desdeTs}).end(${hastaTs}).granularity(DAILY).dimensions(["PRICING_CATEGORY"])`

  try {
    const res = await fetch(`${GRAPH}/${VERSION}/${waba}?fields=${encodeURIComponent(field)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) return { ...VACIO(), error: j?.error?.message || `HTTP ${res.status}` }

    const bloque = j?.pricing_analytics?.data?.[0]
    const crudos: PuntoMeta[] = bloque?.data_points ?? []
    if (!bloque) {
      return { ...VACIO(), error: 'Meta no devolvió datos de facturación (revisa el permiso whatsapp_business_management)' }
    }

    const moneda = String(bloque?.currency || 'CLP')
    const puntos: PuntoCosto[] = crudos.map(p => ({
      fecha: new Date((p.start ?? 0) * 1000).toISOString().slice(0, 10),
      categoria: String(p.pricing_category || 'SERVICE'),
      mensajes: p.volume ?? 0,
      costo: p.cost ?? 0,
    })).sort((a, b) => a.fecha.localeCompare(b.fecha))

    const acc = new Map<string, { mensajes: number; costo: number }>()
    for (const p of puntos) {
      const e = acc.get(p.categoria) ?? { mensajes: 0, costo: 0 }
      e.mensajes += p.mensajes; e.costo += p.costo
      acc.set(p.categoria, e)
    }
    const porCategoria = [...acc].map(([categoria, v]) => ({ categoria, ...v }))
      .sort((a, b) => b.costo - a.costo || b.mensajes - a.mensajes)

    return {
      ok: true,
      moneda,
      desde: puntos[0]?.fecha || '',
      hasta: puntos[puntos.length - 1]?.fecha || '',
      puntos,
      porCategoria,
      total: porCategoria.reduce((s, c) => s + c.costo, 0),
      gratis: porCategoria.filter(c => c.costo === 0).reduce((s, c) => s + c.mensajes, 0),
    }
  } catch (e) {
    return { ...VACIO(), error: e instanceof Error ? e.message : String(e) }
  }
}
