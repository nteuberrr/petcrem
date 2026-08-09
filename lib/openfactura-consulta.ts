import type { FacturaSii } from './eerr-sii'

/**
 * CONSULTA de documentos en OpenFactura (Haulmer) — la contracara de la emisión
 * que vive en [openfactura.ts](openfactura.ts).
 *
 * Reemplaza la descarga manual del CSV del SII. Se llegó acá por descarte: el
 * portal del SII (RCV) protege sus exportaciones con reCAPTCHA a propósito, así
 * que automatizar esa descarga habría significado sortear un control anti-bot de
 * un sistema del Estado. OpenFactura ya es nuestro proveedor de DTE, tiene los
 * mismos documentos y una API pensada para esto.
 *
 *   POST {base}/v2/dte/document/received  → COMPRAS (documentos recibidos)
 *   POST {base}/v2/dte/document/issued    → VENTAS  (documentos emitidos)
 *
 * Ambos aceptan `{ Page, FchEmis: { gte, lte } }` y responden
 * `{ current_page, last_page, data: [...] }`. Los GET equivalentes NO existen
 * (404): el filtro va en el body aunque sea una lectura.
 */

/** Un documento tal como lo devuelve OpenFactura (campos comunes a recibidos/emitidos). */
interface DocOF {
  RUTEmisor?: number
  RUTRecep?: number
  DV?: string
  RznSoc?: string
  RznSocRecep?: string | null
  TipoDTE?: number
  Folio?: number
  FchEmis?: string
  FchRecepSII?: string
  MntExe?: number | null
  MntNeto?: number | null
  IVA?: number | null
  MntTotal?: number | null
  TpoTranCompra?: number | null
}

interface RespuestaOF {
  current_page?: number
  last_page?: number
  data?: DocOF[]
}

function config(): { baseUrl: string; apiKey: string } {
  return {
    baseUrl: (process.env.OPENFACTURA_BASE_URL || 'https://api.haulmer.com').replace(/\/+$/, ''),
    apiKey: process.env.OPENFACTURA_API_KEY || '',
  }
}

export function puedeConsultarOpenFactura(): boolean {
  return !!config().apiKey
}

const dormir = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Primer y último día del mes de un período YYYY-MM. */
export function rangoDelPeriodo(periodo: string): { desde: string; hasta: string } {
  const [y, m] = periodo.split('-').map(Number)
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { desde: `${periodo}-01`, hasta: `${periodo}-${String(ultimo).padStart(2, '0')}` }
}

/**
 * Trae TODAS las páginas de un listado. OpenFactura limita a ~1 request por
 * segundo (responde 429 con "Try again in 1 seconds"), así que se espera entre
 * páginas; sin eso, un mes con varias páginas se cae a la mitad.
 */
async function listar(ruta: string, desde: string, hasta: string): Promise<DocOF[]> {
  const { baseUrl, apiKey } = config()
  if (!apiKey) throw new Error('OpenFactura no está configurado (falta OPENFACTURA_API_KEY).')

  const out: DocOF[] = []
  let page = 1
  let ultima = 1
  // Tope de seguridad: un mes real no pasa de un puñado de páginas; si la API
  // devolviera siempre last_page mayor, esto evita un bucle infinito.
  const MAX_PAGINAS = 50

  do {
    if (page > 1) await dormir(1200)
    const r = await fetch(`${baseUrl}${ruta}`, {
      method: 'POST',
      headers: { apikey: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ Page: page, FchEmis: { gte: desde, lte: hasta } }),
    })
    if (r.status === 429) {
      // Un reintento tras respetar la ventana; si vuelve a rechazar, se corta.
      await dormir(2000)
      continue
    }
    if (!r.ok) {
      const t = await r.text().catch(() => '')
      throw new Error(`OpenFactura respondió ${r.status}${t ? `: ${t.slice(0, 200)}` : ''}`)
    }
    const j = (await r.json()) as RespuestaOF
    out.push(...(j.data ?? []))
    ultima = j.last_page ?? 1
    page++
  } while (page <= ultima && page <= MAX_PAGINAS)

  return out
}

const n = (v: number | null | undefined): string => String(Math.round(Number(v) || 0))

/**
 * Convierte un documento de OpenFactura al mismo shape que produce el parser del
 * CSV del SII, para que la ingesta de compras sea idéntica venga de donde venga.
 *
 * `valor_otro_impuesto` va en 0: OpenFactura no lo expone en el listado. Es un
 * campo que en la práctica solo aparece en combustibles/tabacos, ajeno al giro.
 */
function aFacturaSii(d: DocOF): FacturaSii {
  const rut = d.RUTEmisor ?? d.RUTRecep
  return {
    tipo_doc: String(d.TipoDTE ?? ''),
    tipo_compra: d.TpoTranCompra != null ? String(d.TpoTranCompra) : '',
    rut: rut != null ? `${rut}-${d.DV ?? ''}` : '',
    razon_social: (d.RznSoc ?? d.RznSocRecep ?? '') || '',
    folio: String(d.Folio ?? ''),
    fecha_documento: (d.FchEmis || '').slice(0, 10),
    fecha_recepcion: (d.FchRecepSII || '').slice(0, 10),
    monto_exento: n(d.MntExe),
    monto_neto: n(d.MntNeto),
    monto_iva: n(d.IVA),
    monto_total: n(d.MntTotal),
    valor_otro_impuesto: '0',
  }
}

/** COMPRAS del período (YYYY-MM), ya en el formato que espera la ingesta. */
export async function comprasDelPeriodo(periodo: string): Promise<FacturaSii[]> {
  const { desde, hasta } = rangoDelPeriodo(periodo)
  const docs = await listar('/v2/dte/document/received', desde, hasta)
  return docs.map(aFacturaSii).filter(f => f.rut && f.folio && f.tipo_doc)
}

/** VENTAS emitidas del período (YYYY-MM). */
export async function ventasDelPeriodo(periodo: string): Promise<FacturaSii[]> {
  const { desde, hasta } = rangoDelPeriodo(periodo)
  const docs = await listar('/v2/dte/document/issued', desde, hasta)
  return docs.map(aFacturaSii).filter(f => f.folio && f.tipo_doc)
}
