import type { FacturaSii } from './eerr-sii'
import { grupoDe, type DocVentaSii } from './sii-ventas'

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

/** Acuse registrado sobre un documento recibido (ver openfactura-acuse.ts). */
export interface AcuseOF {
  codEvento?: string
  fechaEvento?: string
  estado?: string
}

/** Un documento tal como lo devuelve OpenFactura (campos comunes a recibidos/emitidos). */
export interface DocOF {
  RUTEmisor?: number
  RUTRecep?: number
  DV?: string
  RznSoc?: string
  RznSocRecep?: string | null
  TipoDTE?: number
  Folio?: number
  FchEmis?: string
  FchRecepSII?: string
  /** Fecha en que el documento llegó a OpenFactura. A diferencia de FchRecepSII, nunca viene vacía. */
  FchRecepOF?: string
  MntExe?: number | null
  MntNeto?: number | null
  IVA?: number | null
  MntTotal?: number | null
  TpoTranCompra?: number | null
  /** Acuses dados al documento. Viene `null` cuando no tiene ninguno. */
  Acuses?: AcuseOF[] | null
}

interface RespuestaOF {
  current_page?: number
  last_page?: number
  data?: DocOF[]
}

export function config(): { baseUrl: string; apiKey: string } {
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
export async function listarDocumentos(ruta: string, desde: string, hasta: string): Promise<DocOF[]> {
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
    // Cuando NO hay documentos en el rango, Haulmer responde 200 con el cuerpo
    // VACÍO (no un JSON con data:[]). Sin esto, `r.json()` explota con
    // "Unexpected end of JSON input" y el usuario ve un error de sistema al
    // sincronizar cualquier mes anterior a su primer documento emitido.
    const texto = await r.text()
    if (!texto.trim()) break
    let j: RespuestaOF
    try { j = JSON.parse(texto) as RespuestaOF } catch { break }
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
  const docs = await listarDocumentos('/v2/dte/document/received', desde, hasta)
  return docs.map(aFacturaSii).filter(f => f.rut && f.folio && f.tipo_doc)
}

const entero = (v: number | null | undefined): number => Math.round(Number(v) || 0)

/**
 * VENTAS emitidas del período, en el MISMO shape que produce el parser de los
 * archivos del SII — así la conciliación no distingue de dónde vino el dato.
 *
 * Reemplaza la descarga manual de los dos CSV del RCV (detalle + boletas
 * diferidas). Se verificó contra los archivos reales de julio y agosto 2026: de
 * los documentos que traía el SII, NINGUNO faltaba acá (incluidas las 41 notas de
 * crédito que anulan boletas de la numeración antigua). Al revés sí sobran, y a
 * favor: OpenFactura trae también lo emitido después de generado el archivo.
 *
 * Ojo con el alcance: esto es lo que se emitió A TRAVÉS DE OPENFACTURA. Si alguna
 * vez se emitiera un documento por otra vía, no aparecería acá — para eso se
 * mantiene la carga manual del archivo del SII, que es el registro del propio SII.
 */
export async function ventasParaConciliacion(periodo: string): Promise<DocVentaSii[]> {
  const { desde, hasta } = rangoDelPeriodo(periodo)
  const docs = await listarDocumentos('/v2/dte/document/issued', desde, hasta)
  return docs
    .filter(d => d.TipoDTE != null && d.Folio != null)
    .map(d => {
      const tipo = Number(d.TipoDTE)
      return {
        tipo_doc: tipo,
        grupo: grupoDe(tipo),
        rut: d.RUTRecep != null ? `${d.RUTRecep}-${d.DV ?? ''}` : '',
        razon_social: d.RznSocRecep ?? '',
        folio: String(d.Folio),
        fecha: (d.FchEmis || '').slice(0, 10),
        exento: entero(d.MntExe),
        neto: entero(d.MntNeto),
        iva: entero(d.IVA),
        total: entero(d.MntTotal),
      }
    })
}
