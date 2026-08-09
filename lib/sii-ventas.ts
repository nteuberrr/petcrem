import { gunzipSync } from 'node:zlib'
import { decodeCsvSii } from './eerr-sii'

/**
 * Parser del REGISTRO DE VENTAS del SII (RCV → pestaña VENTA). Son DOS archivos
 * distintos, con formatos distintos, y la conciliación necesita los dos:
 *
 *  1. «Descargar Detalles» → CSV con las FACTURAS (33/34), notas de crédito (61)
 *     y débito (56). Mismo formato que el de compras pero con una columna extra
 *     ("Fecha Reclamo"), así que los montos van corridos un lugar.
 *  2. «Descargar Boletas» → descarga DIFERIDA (se pide, queda "SOLICITADA", se
 *     refresca hasta "TERMINADA") que entrega un .csv.gz con las boletas (39/41)
 *     y muchas menos columnas.
 *
 * Por eso no hay un parser único: se detecta el layout por el encabezado. Ambos
 * vienen separados por ';' y normalmente en ISO-8859-1 (ver decodeCsvSii).
 */

/** Códigos DTE que nos interesan del registro de ventas. */
export const DTE_FACTURA = 33
export const DTE_FACTURA_EXENTA = 34
export const DTE_BOLETA = 39
export const DTE_BOLETA_EXENTA = 41
export const DTE_NOTA_DEBITO = 56
export const DTE_NOTA_CREDITO = 61

export type GrupoDoc = 'boletas' | 'facturas' | 'notas_credito' | 'notas_debito' | 'otros'

/** A qué grupo de la conciliación pertenece cada tipo de DTE. */
export function grupoDe(tipoDoc: number): GrupoDoc {
  if (tipoDoc === DTE_BOLETA || tipoDoc === DTE_BOLETA_EXENTA) return 'boletas'
  if (tipoDoc === DTE_FACTURA || tipoDoc === DTE_FACTURA_EXENTA) return 'facturas'
  if (tipoDoc === DTE_NOTA_CREDITO) return 'notas_credito'
  if (tipoDoc === DTE_NOTA_DEBITO) return 'notas_debito'
  return 'otros'
}

export interface DocVentaSii {
  tipo_doc: number
  grupo: GrupoDoc
  rut: string
  razon_social: string
  folio: string
  fecha: string    // ISO YYYY-MM-DD
  exento: number
  neto: number
  iva: number
  total: number
}

/** Fecha del SII → ISO. DD/MM/YYYY es lo habitual; se tolera ISO por si pasó por Excel. */
function aIso(s: string): string {
  const t = (s || '').trim()
  if (!t) return ''
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(t)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return ''
}

/**
 * Monto del SII → entero. Algunos archivos traen separador de miles ('502.521') o
 * decimales por coma ('502.521,00'); un parseInt directo devolvería 502.
 */
function num(v?: string): number {
  const s = (v || '').trim()
  if (!s) return 0
  const limpio = s.split(',')[0].replace(/[^\d-]/g, '')
  return limpio === '' || limpio === '-' ? 0 : parseInt(limpio, 10) || 0
}

/**
 * Descomprime si viene en .gz. El archivo de boletas se descarga comprimido y el
 * usuario no tiene por qué abrirlo antes de subirlo. Se detecta por los magic
 * bytes (1f 8b), no por la extensión: el navegador a veces la cambia.
 */
export function descomprimirSiHaceFalta(buf: ArrayBuffer): ArrayBuffer {
  const u8 = new Uint8Array(buf)
  if (u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b) {
    const out = gunzipSync(Buffer.from(u8))
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer
  }
  return buf
}

/** Índice de una columna por nombre (tolerante a mayúsculas, tildes y espacios sobrantes). */
function indiceDe(headers: string[], ...nombres: string[]): number {
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '')
  const hs = headers.map(norm)
  for (const n of nombres) {
    const i = hs.indexOf(norm(n))
    if (i >= 0) return i
  }
  return -1
}

/**
 * Parsea CUALQUIERA de los dos archivos de ventas (detalle o boletas), ya
 * descomprimido y decodificado. El mapeo de columnas se hace por ENCABEZADO, no
 * por posición: los dos layouts difieren y el del SII ha cambiado de columnas
 * antes. Si no hay encabezado reconocible, devuelve vacío (mejor que inventar).
 */
export function parseVentasSii(text: string): DocVentaSii[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length === 0) return []
  const headers = lines[0].split(';').map(h => h.trim())

  const iTipo = indiceDe(headers, 'Tipo Doc', 'Tipo Documento')
  if (iTipo < 0) return []
  const iRut = indiceDe(headers, 'Rut cliente', 'RUT Receptor', 'Rut Receptor')
  const iRazon = indiceDe(headers, 'Razon Social', 'Razón Social')
  const iFolio = indiceDe(headers, 'Folio')
  const iFecha = indiceDe(headers, 'Fecha Docto', 'Fecha Documento')
  const iExento = indiceDe(headers, 'Monto Exento')
  const iNeto = indiceDe(headers, 'Monto Neto')
  const iIva = indiceDe(headers, 'Monto IVA')
  const iTotal = indiceDe(headers, 'Monto total', 'Monto Total')

  const out: DocVentaSii[] = []
  for (const line of lines.slice(1)) {
    const c = line.split(';')
    const tipoRaw = (c[iTipo] || '').trim()
    if (!/^\d+$/.test(tipoRaw)) continue // fila de totales, pie o basura
    const tipo = parseInt(tipoRaw, 10)
    out.push({
      tipo_doc: tipo,
      grupo: grupoDe(tipo),
      rut: iRut >= 0 ? (c[iRut] || '').trim() : '',
      razon_social: iRazon >= 0 ? (c[iRazon] || '').trim() : '',
      folio: iFolio >= 0 ? (c[iFolio] || '').trim() : '',
      fecha: iFecha >= 0 ? aIso(c[iFecha] || '') : '',
      exento: iExento >= 0 ? num(c[iExento]) : 0,
      neto: iNeto >= 0 ? num(c[iNeto]) : 0,
      iva: iIva >= 0 ? num(c[iIva]) : 0,
      total: iTotal >= 0 ? num(c[iTotal]) : 0,
    })
  }
  return out
}

/** Atajo: bytes crudos del archivo subido → documentos. Descomprime y decodifica. */
export function parseArchivoVentas(buf: ArrayBuffer): DocVentaSii[] {
  return parseVentasSii(decodeCsvSii(descomprimirSiHaceFalta(buf)))
}

export interface TotalesGrupo {
  docs: number
  neto: number
  exento: number
  iva: number
  total: number
}

export type ResumenSii = Record<GrupoDoc, TotalesGrupo> & {
  /** Ventas netas del mes: boletas + facturas + notas de débito − notas de crédito. */
  neto_venta: number
  /** Bruto equivalente (lo que entró), con el mismo signo por grupo que `neto_venta`. */
  total_venta: number
  periodos: string[]
}

const vacio = (): TotalesGrupo => ({ docs: 0, neto: 0, exento: 0, iva: 0, total: 0 })

/**
 * Agrupa los documentos y calcula los totales del período.
 *
 * Las NOTAS DE CRÉDITO se acumulan en positivo dentro de su grupo (es lo que se
 * emitió) pero RESTAN en `neto_venta` / `total_venta`: son devoluciones y anular
 * una boleta no es una venta más. Sumarlas fue el error obvio a evitar acá.
 */
export function resumirVentasSii(docs: DocVentaSii[]): ResumenSii {
  const g: Record<GrupoDoc, TotalesGrupo> = {
    boletas: vacio(), facturas: vacio(), notas_credito: vacio(), notas_debito: vacio(), otros: vacio(),
  }
  const periodos = new Set<string>()
  for (const d of docs) {
    const t = g[d.grupo]
    t.docs++
    t.neto += d.neto
    t.exento += d.exento
    t.iva += d.iva
    t.total += d.total
    if (d.fecha) periodos.add(d.fecha.slice(0, 7))
  }
  const suma = (k: keyof TotalesGrupo) =>
    (g.boletas[k] as number) + (g.facturas[k] as number) + (g.notas_debito[k] as number) - (g.notas_credito[k] as number)
  return {
    ...g,
    // Neto de venta = neto afecto + exento (los dos son venta, solo cambia el IVA).
    neto_venta: suma('neto') + suma('exento'),
    total_venta: suma('total'),
    periodos: [...periodos].sort(),
  }
}
