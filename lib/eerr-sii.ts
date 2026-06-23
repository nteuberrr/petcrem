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

/** Parsea el texto del CSV del SII a facturas. Ignora el encabezado y filas vacías. */
export function parseCsvSii(text: string): FacturaSii[] {
  const lines = text.split(/\r?\n/)
  const out: FacturaSii[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    const c = line.split(';')
    const tipoDoc = (c[1] || '').trim()
    const rut = (c[3] || '').trim()
    // Solo filas de datos: Tipo Doc numérico y RUT presente (descarta el encabezado).
    if (!/^\d+$/.test(tipoDoc) || !rut) continue
    out.push({
      tipo_doc: tipoDoc,
      tipo_compra: (c[2] || '').trim(),
      rut,
      razon_social: (c[4] || '').trim(),
      folio: (c[5] || '').trim(),
      fecha_documento: aIso(c[6] || ''),
      fecha_recepcion: aIso(c[7] || ''),
      monto_exento: num(c[9]),
      monto_neto: num(c[10]),
      monto_iva: num(c[11]),
      monto_total: num(c[14]),
      valor_otro_impuesto: num(c[25]),
    })
  }
  return out
}
