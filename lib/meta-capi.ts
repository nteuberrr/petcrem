import crypto from 'node:crypto'

/**
 * CONVERSIONS API DE META — le devuelve a Facebook/Instagram la conversión real.
 *
 * El gemelo del `subirConversionesPorClic` de Google. La diferencia es de dónde
 * sale el identificador del clic:
 *   · WEB   → `fbclid` en la URL de la landing, que se guarda en `ads_clicks` y
 *             acá se convierte al formato `fbc` que Meta espera.
 *   · CTWA  → `ctwa_clid`, que Meta manda en el propio webhook de WhatsApp
 *             cuando el cliente llega desde un anuncio click-to-WhatsApp.
 *
 * Por qué el pixel del sitio no alcanza: la venta NO ocurre en el sitio. El
 * visitante toca el botón de WhatsApp y se va; lo que pasa después —la
 * conversación, el retiro, la ficha— es invisible para el navegador. Sin esto,
 * Meta optimiza hacia «alguien hizo clic», que es exactamente lo que estaba
 * pasando (tres campañas con objetivo LINK_CLICKS).
 *
 * Configuración: `META_PIXEL_ID` (el dataset; por defecto el mismo pixel que ya
 * corre en el sitio) y `META_CAPI_TOKEN` — un token con permiso `ads_management`
 * sobre el dataset; si no está, cae a `META_GRAPH_TOKEN`. Opcional
 * `META_CAPI_TEST_CODE` para que los eventos aparezcan en «Probar eventos» del
 * Administrador de eventos sin contaminar los datos reales.
 */

/** El mismo pixel que inyecta el sitio público (lib/sitio/landings.ts). */
const PIXEL_POR_DEFECTO = '1324716849538772'

function pixelId(): string { return process.env.META_PIXEL_ID || PIXEL_POR_DEFECTO }
function token(): string { return process.env.META_CAPI_TOKEN || process.env.META_GRAPH_TOKEN || '' }
const API = process.env.META_API_VERSION || process.env.WHATSAPP_API_VERSION || 'v22.0'

export function isMetaCapiConfigurado(): boolean { return !!token() && !!pixelId() }

/** Meta exige los datos personales hasheados en SHA-256, normalizados antes. */
const hash = (v: string): string => crypto.createHash('sha256').update(v).digest('hex')

/** Teléfono chileno → formato internacional sin símbolos (56912345678). */
export function normalizarTelefono(tel: string | null | undefined): string | null {
  const d = String(tel ?? '').replace(/\D/g, '')
  if (!d) return null
  if (d.length === 9) return `56${d}`
  if (d.length === 11 && d.startsWith('56')) return d
  return d.length >= 8 ? d : null
}

/**
 * `fbc`: el formato en que Meta espera el clic. Es lo que el pixel guardaría en
 * la cookie `_fbc` si la conversión ocurriera en el sitio — como ocurre en
 * WhatsApp, lo reconstruimos con el momento del clic.
 */
export function fbcDe(fbclid: string, cuandoIso: string): string {
  const ms = new Date(cuandoIso).getTime()
  return `fb.1.${Number.isFinite(ms) ? ms : Date.now()}.${fbclid}`
}

export interface EventoCapi {
  /** 'Lead' (empezó la conversación) o 'Purchase' (ficha cerrada). */
  nombre: 'Lead' | 'Purchase'
  /** Cuándo ocurrió de verdad. Meta rechaza eventos de más de 7 días. */
  cuando: Date
  /** Clave de deduplicación: reenviar el mismo evento no lo cuenta dos veces. */
  eventId: string
  fbc?: string | null
  ctwaClid?: string | null
  telefono?: string | null
  email?: string | null
  valor?: number
  moneda?: string
}

export interface ResultadoCapi {
  enviados: number
  /** Índices (del array de entrada) que Meta aceptó. */
  aceptados: boolean[]
  errores: string[]
}

/** Meta rechaza eventos con más de 7 días; los descartamos antes de gastar la llamada. */
const MAX_DIAS = 7

export function demasiadoViejo(cuando: Date): boolean {
  return (Date.now() - cuando.getTime()) / 86400000 > MAX_DIAS
}

/**
 * Envía un lote de eventos. Meta responde con un único resultado para todo el
 * lote (no evento por evento), así que el éxito es de todos o de ninguno: si la
 * llamada falla, no se marca nada como subido y la próxima corrida reintenta.
 */
export async function enviarEventosCapi(eventos: EventoCapi[], testCode?: string): Promise<ResultadoCapi> {
  const vacio: ResultadoCapi = { enviados: 0, aceptados: eventos.map(() => false), errores: [] }
  if (!eventos.length) return { ...vacio, errores: [] }
  if (!isMetaCapiConfigurado()) return { ...vacio, errores: ['Meta CAPI no configurado (falta META_CAPI_TOKEN / META_GRAPH_TOKEN)'] }

  const data = eventos.map(e => {
    const userData: Record<string, unknown> = {}
    const tel = normalizarTelefono(e.telefono)
    if (tel) userData.ph = [hash(tel)]
    const mail = (e.email || '').trim().toLowerCase()
    if (mail) userData.em = [hash(mail)]
    if (e.fbc) userData.fbc = e.fbc
    if (e.ctwaClid) userData.ctwa_clid = e.ctwaClid

    const evento: Record<string, unknown> = {
      event_name: e.nombre,
      event_time: Math.floor(e.cuando.getTime() / 1000),
      event_id: e.eventId,
      // `business_messaging` es el canal que Meta espera cuando la conversión
      // ocurrió dentro de una conversación abierta por un anuncio de WhatsApp;
      // el resto llega desde la web pero se cierra fuera de ella → 'other'.
      action_source: e.ctwaClid ? 'business_messaging' : 'other',
      user_data: userData,
    }
    if (e.ctwaClid) evento.messaging_channel = 'whatsapp'
    if (e.valor && e.valor > 0) {
      evento.custom_data = { value: e.valor, currency: e.moneda || 'CLP', order_id: e.eventId }
    }
    return evento
  })

  const body: Record<string, unknown> = { data, access_token: token() }
  const test = testCode || process.env.META_CAPI_TEST_CODE
  if (test) body.test_event_code = test

  try {
    const res = await fetch(`https://graph.facebook.com/${API}/${pixelId()}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const j = await res.json().catch(() => ({})) as { events_received?: number; error?: { message?: string } }
    if (!res.ok) {
      return { ...vacio, errores: [j?.error?.message || `HTTP ${res.status}`] }
    }
    return { enviados: j.events_received ?? eventos.length, aceptados: eventos.map(() => true), errores: [] }
  } catch (e) {
    return { ...vacio, errores: [e instanceof Error ? e.message : String(e)] }
  }
}
