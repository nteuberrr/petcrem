import './_env-preload'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { decodeCsvSii } from '../lib/eerr-sii'
import { getSheetData } from '../lib/datastore'

// Cruza lo cargado en eerr_gastos_sii vs los valores CRUDOS de los CSV del SII.
// Uso: npx tsx scripts/verificar-compras-sii.ts "C:/ruta/a/carpeta"

const DIR = process.argv[2] || 'C:/Users/Nicolas/Downloads/Nueva carpeta'

function aIso(s: string): string {
  const t = (s || '').trim()
  if (!t) return ''
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(t)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return ''
}
const int = (v: string | undefined) => parseInt((v || '').replace(/[^\d-]/g, ''), 10) || 0

interface Raw {
  archivo: string; key: string; rut: string; tipo_doc: string; folio: string; razon: string
  fecha: string; exento: number; neto: number; iva: number; iva_norec: number; total: number; otro: number
}

async function main() {
  const files = readdirSync(DIR).filter(f => f.toLowerCase().endsWith('.csv')).sort()
  const fuente = new Map<string, Raw>()
  let totalFilas = 0, intraDup = 0
  for (const file of files) {
    const buf = readFileSync(join(DIR, file))
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    for (const line of decodeCsvSii(ab).split(/\r?\n/)) {
      if (!line.trim()) continue
      const c = line.split(';')
      const tipo = (c[1] || '').trim(), rut = (c[3] || '').trim()
      if (!/^\d+$/.test(tipo) || !rut) continue
      totalFilas++
      const folio = (c[5] || '').trim()
      const key = `${rut}|${tipo}|${folio}`
      const r: Raw = {
        archivo: file, key, rut, tipo_doc: tipo, folio, razon: (c[4] || '').trim(),
        fecha: aIso(c[6] || ''), exento: int(c[9]), neto: int(c[10]), iva: int(c[11]),
        iva_norec: int(c[12]), total: int(c[14]), otro: int(c[25]),
      }
      if (fuente.has(key)) intraDup++
      fuente.set(key, r) // último gana (igual que el dedup de carga)
    }
  }

  const db = await getSheetData('eerr_gastos_sii')
  const dbByKey = new Map(db.map(r => [`${r.rut}|${r.tipo_doc}|${r.folio}`, r]))

  console.log(`Archivos: ${files.length} | filas de datos: ${totalFilas} | únicas (dedup): ${fuente.size} | dups intra-archivos: ${intraDup}`)
  console.log(`En base (eerr_gastos_sii): ${db.length}`)

  let soloFuente = 0, soloDb = 0, conDif = 0
  const difFecha: string[] = [], difMonto: string[] = [], ivaNoRec: string[] = [], descuadre: string[] = [], faltan: string[] = []

  for (const [key, r] of fuente) {
    const d = dbByKey.get(key)
    if (!d) { soloFuente++; if (faltan.length < 30) faltan.push(`[${r.archivo}] ${r.razon} folio ${r.folio} (${r.fecha || 's/fecha'}) total ${r.total}`); continue }
    const difs: string[] = []
    if ((d.fecha_documento || '') !== r.fecha) difs.push(`fecha base=${d.fecha_documento || '(vacío)'} archivo=${r.fecha || '(vacío)'}`)
    if (int(d.monto_exento) !== r.exento) difs.push(`exento base=${int(d.monto_exento)} archivo=${r.exento}`)
    if (int(d.monto_neto) !== r.neto) difs.push(`neto base=${int(d.monto_neto)} archivo=${r.neto}`)
    if (int(d.monto_iva) !== r.iva) difs.push(`iva base=${int(d.monto_iva)} archivo=${r.iva}`)
    if (int(d.valor_otro_impuesto) !== r.otro) difs.push(`otro base=${int(d.valor_otro_impuesto)} archivo=${r.otro}`)
    if (int(d.monto_total) !== r.total) difs.push(`total base=${int(d.monto_total)} archivo=${r.total}`)
    if (difs.length) {
      conDif++
      const tag = `[${r.archivo}] ${r.razon} folio ${r.folio}: ${difs.join(' | ')}`
      if (difs.some(x => x.startsWith('fecha')) && difs.length === 1) { if (difFecha.length < 40) difFecha.push(tag) }
      else { if (difMonto.length < 40) difMonto.push(tag) }
    }
    if (r.iva_norec > 0 && ivaNoRec.length < 40) ivaNoRec.push(`[${r.archivo}] ${r.razon} folio ${r.folio}: iva_norec(col12)=${r.iva_norec}, iva_rec(col11)=${r.iva}, neto=${r.neto}, total=${r.total}`)
    const suma = r.exento + r.neto + r.iva + r.otro
    if (suma !== r.total && descuadre.length < 40) descuadre.push(`[${r.archivo}] ${r.razon} folio ${r.folio}: exento ${r.exento}+neto ${r.neto}+iva ${r.iva}+otro ${r.otro} = ${suma} ≠ total ${r.total} (dif ${r.total - suma}; iva_norec=${r.iva_norec})`)
  }
  const extras: string[] = []
  for (const [key, d] of dbByKey) if (!fuente.has(key)) {
    soloDb++
    extras.push(`folio ${d.folio} | ${d.razon_social} | ${d.fecha_documento || 's/fecha'} | neto ${int(d.monto_neto)} exento ${int(d.monto_exento)} total ${int(d.monto_total)} | partida=${d.partida_id || '(sin asignar)'} contab=${d.contabilizado}`)
  }

  console.log(`\n== RESUMEN CRUCE ==`)
  console.log(`En archivos pero NO en base : ${soloFuente}`)
  console.log(`En base pero NO en archivos : ${soloDb}`)
  console.log(`En ambos con alguna dif     : ${conDif}  (solo fecha: ${difFecha.length}${difFecha.length >= 40 ? '+' : ''} | montos: ${difMonto.length}${difMonto.length >= 40 ? '+' : ''})`)
  console.log(`Con IVA No Recuperable (col12)>0 : ${ivaNoRec.length}${ivaNoRec.length >= 40 ? '+' : ''}`)
  console.log(`Descuadre exento+neto+iva+otro≠total (en el archivo): ${descuadre.length}${descuadre.length >= 40 ? '+' : ''}`)

  const show = (title: string, arr: string[]) => { if (arr.length) { console.log(`\n--- ${title} ---`); arr.forEach(x => console.log('  ' + x)) } }
  show('EN BASE PERO NO EN ESTOS ARCHIVOS (7)', extras)
  show('FALTAN EN BASE', faltan)
  show('DIF SOLO FECHA', difFecha)
  show('DIF MONTOS', difMonto)
  show('IVA NO RECUPERABLE (col 12)', ivaNoRec)
  show('DESCUADRE exento+neto+iva+otro ≠ total', descuadre)
}

main().catch(e => { console.error('ERROR:', e instanceof Error ? e.stack : e); process.exit(1) })
