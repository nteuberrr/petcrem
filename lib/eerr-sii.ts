// Parser del CSV "Registro de Compras (RCV)" que se descarga del SII.
// Formato: separado por ';', primera fila encabezado. Columnas (0-index):
//   0 Nro · 1 Tipo Doc · 2 Tipo Compra · 3 RUT Proveedor · 4 Razon Social ·
//   5 Folio · 6 Fecha Docto · 7 Fecha Recepcion · 8 Fecha Acuse ·
//   9 Monto Exento · 10 Monto Neto · 11 Monto IVA Recuperable · 14 Monto Total ·
//   25 Valor Otro Impuesto
// La fecha que vale para el mes es la de EMISIÓN (Fecha Docto).

export interface FacturaSii {
  tipo_doc: string
  tipo_compra: string
  rut: string
  razon_social: string
  folio: string
  fecha_documento: string   // ISO YYYY-MM-DD (emisión)
  fecha_recepcion: string   // ISO YYYY-MM-DD
  monto_exento: string
  monto_neto: string
  monto_iva: string
  monto_total: string
  valor_otro_impuesto: string
  /**
   * Período tributario del SII (YYYY-MM) en que la compra entra al Registro, que
   * NO es el mes de emisión ni el de recepción. Ver `periodoSiiDe` en
   * [eerr-compras-ingesta.ts](eerr-compras-ingesta.ts). Opcional: el CSV del SII
   * no lo trae por documento y ahí se deduce al leer.
   */
  periodo_sii?: string
}

/**
 * Normaliza una fecha del SII a ISO (YYYY-MM-DD). Tolera varios formatos por si el
 * archivo pasó por Excel: DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD (con o sin hora) y el
 * serial de Excel (número de días desde 1899-12-30). Vacío si no parsea.
 */
function aIso(s: string): string {
  const t = (s || '').trim()
  if (!t) return ''
  // ISO: YYYY-MM-DD (posible hora después)
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  // DD/MM/YYYY o DD-MM-YYYY (barras o guiones; posible hora después)
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(t)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  // Serial de Excel (offset 25569 = días entre 1899-12-30 y 1970-01-01)
  if (/^\d{1,6}$/.test(t)) {
    const n = parseInt(t, 10)
    if (n > 0 && n < 100000) {
      const d = new Date((n - 25569) * 86400 * 1000)
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
    }
  }
  return ''
}

/**
 * Número de celda del SII (montos en CLP, enteros). Normaliza a un entero "limpio":
 * algunos archivos vienen con separador de miles ('502.521') o con decimales por
 * coma ('502.521,00'); guardarlos así rompe el `parseInt` de la UI/EERR
 * ('502.521' → 502). Quitamos el separador de miles y cualquier parte decimal,
 * dejando solo dígitos (y signo). '0' si viene vacío.
 */
function num(v?: string): string {
  const s = (v || '').trim()
  if (s === '') return '0'
  const limpio = s.split(',')[0].replace(/[^\d-]/g, '')
  return limpio === '' || limpio === '-' ? '0' : limpio
}

/**
 * Decodifica el archivo del SII probando UTF-8 estricto y, si falla, Latin-1
 * (los CSV del SII suelen venir en ISO-8859-1).
 */
export function decodeCsvSii(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('iso-8859-1').decode(buf)
  }
}

/** Normaliza un nombre de columna para compararlo: sin tildes, puntos ni dobles espacios. */
const normCol = (s: string) =>
  s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\./g, '').replace(/\s+/g, ' ')

/**
 * Tipo de documento sacado del NOMBRE del archivo del SII.
 *
 * Cuando en el RCV se entra a un tipo de documento en particular, el CSV que
 * descarga se llama `..._<AAAAMM>_<tipo>.csv` y **no trae la columna «Tipo
 * Doc»** — el tipo está solo en el nombre. Sin esto esos archivos se cargaban
 * como cero filas, en silencio.
 */
export function tipoDocDeNombre(nombre: string): string {
  const m = (nombre || '').match(/_\d{6}_(\d{2,3})\.csv$/i)
  return m ? m[1] : ''
}

/**
 * Parsea el CSV de COMPRAS del SII. Mapea por ENCABEZADO, no por posición: el
 * archivo por tipo de documento tiene una columna menos que el combinado, así
 * que leer por índice corría todos los montos.
 *
 * `tipoDocPorDefecto` cubre justamente ese archivo, que no trae «Tipo Doc»:
 * pásale `tipoDocDeNombre(archivo)`.
 */
export function parseCsvSii(text: string, tipoDocPorDefecto = ''): FacturaSii[] {
  const lines = text.split(/\r?\n/)
  const iHead = lines.findIndex(l => normCol(l).includes('rut proveedor'))
  if (iHead < 0) return []

  const cols = lines[iHead].split(';').map(normCol)
  const at = (nombre: string) => cols.indexOf(normCol(nombre))
  const iTipo = at('Tipo Doc')
  const c = {
    tipoCompra: at('Tipo Compra'),
    rut: at('RUT Proveedor'),
    razon: at('Razon Social'),
    folio: at('Folio'),
    emision: at('Fecha Docto'),
    recepcion: at('Fecha Recepcion'),
    exento: at('Monto Exento'),
    neto: at('Monto Neto'),
    iva: at('Monto IVA Recuperable'),
    total: at('Monto Total'),
    otro: at('Valor Otro Impuesto'),
  }
  if (c.rut < 0 || c.folio < 0) return []

  const val = (f: string[], i: number) => (i >= 0 ? (f[i] || '').trim() : '')
  const out: FacturaSii[] = []
  for (const line of lines.slice(iHead + 1)) {
    if (!line.trim()) continue
    const f = line.split(';')
    const rut = val(f, c.rut)
    const tipoDoc = iTipo >= 0 ? val(f, iTipo) : tipoDocPorDefecto
    if (!/^\d+$/.test(tipoDoc) || !rut) continue
    out.push({
      tipo_doc: tipoDoc,
      tipo_compra: val(f, c.tipoCompra),
      rut,
      razon_social: val(f, c.razon),
      folio: val(f, c.folio),
      fecha_documento: aIso(val(f, c.emision)),
      fecha_recepcion: aIso(val(f, c.recepcion)),
      monto_exento: num(val(f, c.exento)),
      monto_neto: num(val(f, c.neto)),
      monto_iva: num(val(f, c.iva)),
      monto_total: num(val(f, c.total)),
      valor_otro_impuesto: num(val(f, c.otro)),
    })
  }
  return out
}
