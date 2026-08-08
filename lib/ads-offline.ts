import { getSheetData } from './datastore'
import { pendientesDeSubir, marcarSubidos, type AdsClick } from './ads-clicks'
import { isGoogleAdsConfigurado, subirConversionesPorClic, fechaHoraAds, type ConversionPorClic } from './google-ads'

/**
 * CONVERSIONES OFFLINE — la pata que le devuelve a Google Ads la venta real.
 *
 * Cierra el recorrido que arranca en supabase/migracion-ads-clicks.sql: por cada
 * clic de anuncio que terminó en ficha, le informa a Google el gclid, cuándo se
 * cerró y por CUÁNTO. Eso es lo que le permite pujar por lo que deja plata en vez
 * de por «alguien apretó el botón de WhatsApp».
 *
 * Lo corre el cron diario. Es idempotente por dos vías: `subido_at` en la tabla y
 * `orderId` del lado de Google (reenviar la misma ficha no la cuenta dos veces).
 */

/** La acción se creó por API el 2026-08-07. Se puede pisar por env si se recrea. */
export const ACCION_OFFLINE = process.env.GOOGLE_ADS_CONVERSION_FICHA
  || 'customers/8650361913/conversionActions/7713114689'

const LOTE = 200

export interface ResultadoSubida {
  candidatas: number
  subidas: number
  esperando: number
  errores: string[]
}

const monto = (v: unknown): number => {
  const n = parseFloat(String(v ?? '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * Sube a Google Ads las fichas atribuibles a un clic que todavía no se informaron.
 *
 * Una ficha se informa cuando **deja de ser borrador**: el borrador que crea el
 * bot todavía no tiene precio ni confirmación del equipo, y una conversión sin
 * valor le enseña a Google lo contrario de lo que queremos. Las que siguen en
 * borrador quedan pendientes y se recogen en la corrida siguiente.
 */
export async function subirConversionesOffline(validateOnly = false): Promise<ResultadoSubida> {
  const vacio: ResultadoSubida = { candidatas: 0, subidas: 0, esperando: 0, errores: [] }
  if (!isGoogleAdsConfigurado()) return { ...vacio, errores: ['Google Ads no está configurado'] }

  const pendientes = await pendientesDeSubir(LOTE)
  if (!pendientes.length) return vacio

  let clientes: Record<string, string>[] = []
  try { clientes = await getSheetData('clientes') } catch (e) {
    return { ...vacio, candidatas: pendientes.length, errores: [`No se pudo leer clientes: ${e instanceof Error ? e.message : e}`] }
  }
  const porId = new Map(clientes.map(c => [String(c.id), c]))

  const listas: Array<{ click: AdsClick; conv: ConversionPorClic }> = []
  let esperando = 0

  for (const click of pendientes) {
    const ficha = porId.get(String(click.cliente_id))
    // La ficha se borró: no hay nada que informar y no tiene sentido reintentarla
    // para siempre, así que se marca como resuelta más abajo.
    if (!ficha) continue
    if (String(ficha.estado || '').toLowerCase() === 'borrador') { esperando++; continue }

    const cuando = click.vinculado_at || click.created_at
    const fecha = new Date(cuando)
    if (Number.isNaN(fecha.getTime())) { esperando++; continue }

    listas.push({
      click,
      conv: {
        ...(click.gclid ? { gclid: click.gclid } : {}),
        ...(click.gbraid ? { gbraid: click.gbraid } : {}),
        ...(click.wbraid ? { wbraid: click.wbraid } : {}),
        conversionAction: ACCION_OFFLINE,
        conversionDateTime: fechaHoraAds(fecha),
        conversionValue: monto(ficha.precio_total) || monto(ficha.precio_servicio),
        currencyCode: 'CLP',
        orderId: `ficha-${click.cliente_id}`,
      },
    })
  }

  // Fichas que ya no existen: se dan por cerradas para que no queden reintentándose.
  const huerfanas = pendientes.filter(p => !porId.has(String(p.cliente_id))).map(p => p.id)
  if (huerfanas.length && !validateOnly) await marcarSubidos(huerfanas)

  if (!listas.length) return { candidatas: pendientes.length, subidas: 0, esperando, errores: [] }

  const { aceptadas, errores } = await subirConversionesPorClic(listas.map(l => l.conv), validateOnly)
  const okIds = listas.filter((_, i) => aceptadas[i]).map(l => l.click.id)
  if (okIds.length && !validateOnly) await marcarSubidos(okIds)

  return { candidatas: pendientes.length, subidas: okIds.length, esperando, errores }
}
