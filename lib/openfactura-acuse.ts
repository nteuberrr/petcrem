import { todayISO } from './dates'
import { config, listarDocumentos, rangoDelPeriodo, type DocOF } from './openfactura-consulta'

/**
 * ACUSE de las facturas de compra — aceptarlas o reclamarlas ante el SII sin
 * salir de la sección Compras.
 *
 * El receptor de una factura electrónica tiene **8 días corridos** desde que el
 * SII la recibió para reclamarla (Ley 19.983). Si no hace nada, opera el *acuse
 * de recibo tácito*: la factura queda irrevocablemente aceptada y con mérito
 * ejecutivo. Ese plazo es la razón de ser de este módulo — vencido, ya no hay
 * nada que decidir.
 *
 *   POST {base}/v2/dte/document/received/accuse  → { rut, dte, folio, acuse }
 *
 * El estado NO se guarda en nuestra base a propósito: el SII lo cambia solo al
 * vencer el plazo, así que una copia local mentiría a los pocos días. Se lee en
 * vivo de OpenFactura, que expone el campo `Acuses` por documento (`null` = sin
 * acuse = "Pendiente" en el Registro de Compras del SII; verificado contra
 * `/v2/dte/registry/purchase/{año}/{mes}`, los conteos calzan exacto).
 *
 * ⚠️ Dar acuse es IRREVERSIBLE y tiene efecto legal ante el SII. Todo camino que
 * llegue acá debe pedir confirmación explícita antes.
 */

/** Plazo legal para reclamar, en días corridos desde la recepción en el SII. */
export const PLAZO_ACUSE_DIAS = 8

/**
 * Tipos de DTE que admiten acuse: factura (33), factura exenta (34), factura de
 * compra (46) y nota de débito (56).
 *
 * Las notas de CRÉDITO (61) quedan fuera aposta — no se reclaman, porque juegan a
 * favor del receptor. Sin este filtro se colaban a la lista y el panel mostraba
 * un pendiente de más: el SII contaba 4 en julio y nosotros 5, y la diferencia
 * era exactamente una NC (verificado con scripts/verificar-acuse-compras.ts).
 */
const TIPOS_CON_ACUSE = new Set([33, 34, 46, 56])

/** Los cinco acuses que acepta el SII, con el texto que ve el usuario. */
export const TIPOS_ACUSE = {
  ACD: { label: 'Aceptar el contenido', desc: 'Acepta la factura tal como viene.', reclamo: false },
  ERM: { label: 'Otorgar recibo de mercaderías', desc: 'Confirma que recibiste los bienes o servicios.', reclamo: false },
  RCD: { label: 'Reclamar el contenido', desc: 'El monto, el detalle o los datos están equivocados.', reclamo: true },
  RFP: { label: 'Reclamar por falta parcial', desc: 'Llegó solo una parte de lo facturado.', reclamo: true },
  RFT: { label: 'Reclamar por falta total', desc: 'Nunca recibiste lo facturado.', reclamo: true },
} as const

export type TipoAcuse = keyof typeof TIPOS_ACUSE

export const esTipoAcuse = (v: string): v is TipoAcuse => v in TIPOS_ACUSE

export interface DocPendienteAcuse {
  rut: string
  razon_social: string
  tipo_doc: number
  folio: string
  fecha_emision: string
  /** Fecha desde la que corre el plazo: la de recepción en el SII. */
  fecha_recepcion: string
  monto_total: number
  dias_transcurridos: number
  /** Días que quedan para reclamar. 0 o menos = ya operó el acuse tácito. */
  dias_restantes: number
  vencido: boolean
}

/** Diferencia en días corridos entre dos fechas ISO (YYYY-MM-DD). */
function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T12:00:00Z`)
  const b = Date.parse(`${hasta}T12:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.round((b - a) / 86400000)
}

/** Resta meses a un período YYYY-MM. */
function periodoMenos(periodo: string, meses: number): string {
  const [y, m] = periodo.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 - meses, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function aPendiente(d: DocOF, hoy: string): DocPendienteAcuse {
  // FchRecepSII puede venir vacía mientras OpenFactura no la resuelve; ahí se usa
  // la de recepción propia, que siempre existe y difiere en horas, no en días.
  const recepcion = (d.FchRecepSII || d.FchRecepOF || d.FchEmis || '').slice(0, 10)
  const transcurridos = recepcion ? diasEntre(recepcion, hoy) : 0
  const restantes = PLAZO_ACUSE_DIAS - transcurridos
  return {
    rut: d.RUTEmisor != null ? `${d.RUTEmisor}-${d.DV ?? ''}` : '',
    razon_social: d.RznSoc ?? '',
    tipo_doc: Number(d.TipoDTE ?? 0),
    folio: String(d.Folio ?? ''),
    fecha_emision: (d.FchEmis || '').slice(0, 10),
    fecha_recepcion: recepcion,
    monto_total: Math.round(Number(d.MntTotal) || 0),
    dias_transcurridos: transcurridos,
    dias_restantes: restantes,
    vencido: restantes <= 0,
  }
}

/**
 * Documentos recibidos que todavía no tienen ningún acuse, del más urgente al
 * menos. Mira `mesesAtras` meses hacia atrás: los que llevan mucho tiempo sin
 * acuse ya vencieron, pero se muestran igual porque siguen figurando como
 * "Pendiente" en el Registro de Compras del SII.
 */
export async function pendientesDeAcuse(mesesAtras = 2): Promise<DocPendienteAcuse[]> {
  const hoy = todayISO()
  const { desde } = rangoDelPeriodo(periodoMenos(hoy.slice(0, 7), mesesAtras))
  const docs = await listarDocumentos('/v2/dte/document/received', desde, hoy)
  return docs
    .filter(d => !d.Acuses || d.Acuses.length === 0)
    .filter(d => d.Folio != null && d.TipoDTE != null && TIPOS_CON_ACUSE.has(Number(d.TipoDTE)))
    .map(d => aPendiente(d, hoy))
    .sort((a, b) => a.dias_restantes - b.dias_restantes)
}

export interface ResultadoAcuse {
  ok: boolean
  /** Mensaje del SII/OpenFactura, ya legible. */
  mensaje: string
}

/**
 * Da acuse a un documento recibido. IRREVERSIBLE: confirmar antes de llamar.
 *
 * OpenFactura responde con un sobre `{message, code, details}`; cuando el SII
 * rechaza (folio inexistente, plazo vencido, acuse repetido) viene un 400 con el
 * detalle adentro, así que se desenvuelve para no mostrar "Error" a secas.
 */
export async function darAcuse(rut: string, dte: number, folio: number, acuse: TipoAcuse): Promise<ResultadoAcuse> {
  const { baseUrl, apiKey } = config()
  if (!apiKey) throw new Error('OpenFactura no está configurado (falta OPENFACTURA_API_KEY).')

  const r = await fetch(`${baseUrl}/v2/dte/document/received/accuse`, {
    method: 'POST',
    headers: { apikey: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rut, dte, folio, acuse }),
  })
  const texto = await r.text()
  let j: Record<string, unknown> = {}
  try { j = texto.trim() ? JSON.parse(texto) : {} } catch { /* respuesta no-JSON: se cae al texto crudo */ }

  const detalle = (j.details ?? j) as { msg?: unknown; result?: string }
  const msg = detalle?.msg
  const desdeSii = Array.isArray(msg)
    ? msg.map(m => String((m as { descResp?: string })?.descResp || '')).filter(Boolean).join(' · ')
    : typeof msg === 'string' ? msg
    : typeof (msg as { descResp?: string })?.descResp === 'string' ? String((msg as { descResp?: string }).descResp)
    : ''

  if (!r.ok || detalle?.result === 'error') {
    return { ok: false, mensaje: desdeSii || String(j.message || texto.slice(0, 200) || `HTTP ${r.status}`) }
  }
  return { ok: true, mensaje: desdeSii || 'Acuse registrado en el SII.' }
}
