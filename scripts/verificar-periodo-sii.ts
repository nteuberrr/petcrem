import './_env-preload'
import fs from 'node:fs'
import { getSheetData } from '../lib/datastore'
import { periodoSiiDe } from '../lib/eerr-compras-ingesta'
import { comprasDelPeriodo } from '../lib/openfactura-consulta'

/**
 * Contrasta el período tributario que calculamos contra el RCV real del SII.
 *
 * El archivo se baja del SII (Registro de Compras → «Descargar Detalles») y se
 * llama `RCV_COMPRA_REGISTRO_<rut>_<AAAAMM>_<tipo>.csv`. El período sale del
 * nombre. Si algún documento no cae en el mes que dice el SII, el crédito
 * fiscal del F29 va a quedar en el mes equivocado.
 *
 *   npx tsx scripts/verificar-periodo-sii.ts <ruta-al-csv> [...más csv]
 */

function leerRcv(ruta: string): { periodo: string; folios: Set<string> } {
  const nombre = ruta.split(/[\\/]/).pop() || ''
  const m = nombre.match(/_(\d{4})(\d{2})_/)
  if (!m) throw new Error(`No pude sacar el período del nombre: ${nombre}`)
  const texto = fs.readFileSync(ruta, 'utf8')
  const folios = new Set<string>()
  for (const linea of texto.split(/\r?\n/).slice(1)) {
    const col = linea.split(';')
    if (col.length > 5 && col[4]?.trim()) folios.add(col[4].trim())
  }
  return { periodo: `${m[1]}-${m[2]}`, folios }
}

async function main() {
  const rutas = process.argv.slice(2)
  if (rutas.length === 0) throw new Error('Pasa al menos un CSV del RCV del SII.')

  const gastos = await getSheetData('eerr_gastos_sii')
  let fallas = 0

  for (const ruta of rutas) {
    const { periodo, folios } = leerRcv(ruta)
    console.log(`\n=== ${ruta.split(/[\\/]/).pop()} → período ${periodo}, ${folios.size} documentos ===\n`)

    // Refresca el dato con lo que trae OpenFactura hoy, sin escribir nada.
    const [mesPrev, mesAct] = [-1, 0].map(d => {
      const [y, m] = periodo.split('-').map(Number)
      const f = new Date(Date.UTC(y, m - 1 + d, 1))
      return `${f.getUTCFullYear()}-${String(f.getUTCMonth() + 1).padStart(2, '0')}`
    })
    const frescos = new Map<string, string>()
    for (const p of [mesPrev, mesAct]) {
      for (const f of await comprasDelPeriodo(p)) if (f.periodo_sii) frescos.set(f.folio, f.periodo_sii)
    }

    for (const folio of folios) {
      const fila = gastos.find(g => String(g.folio) === folio)
      if (!fila) { console.log(`  ${folio.padEnd(10)} → no está cargada`); continue }
      const nuestro = frescos.get(folio) || periodoSiiDe(fila)
      const ok = nuestro === periodo
      if (!ok) fallas++
      console.log(`  ${folio.padEnd(10)} emis=${fila.fecha_documento} recep=${fila.fecha_recepcion} → nosotros ${nuestro}  ${ok ? '✓' : `✗ el SII dice ${periodo}`}`)
    }
  }

  console.log(fallas === 0
    ? '\n✓ Todos caen en el período que declara el SII.\n'
    : `\n✗ ${fallas} documento(s) en el mes equivocado — el crédito fiscal del F29 no va a cuadrar.\n`)
  process.exit(fallas === 0 ? 0 : 1)
}

main().catch(e => { console.error('\n✗', e instanceof Error ? e.message : e, '\n'); process.exit(1) })
