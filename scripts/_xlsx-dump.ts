/** Utilidad: vuelca el contenido de un .xlsx como JSON para inspeccionarlo.
 *  npx tsx scripts/_xlsx-dump.ts "<ruta.xlsx>"
 */
import * as XLSX from 'xlsx-js-style'

const path = process.argv[2]
if (!path) { console.error('Uso: npx tsx scripts/_xlsx-dump.ts "<ruta.xlsx>"'); process.exit(1) }

const wb = XLSX.readFile(path)
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name]
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
  console.log(`=== Hoja: ${name} (${rows.length} filas) ===`)
  console.log(JSON.stringify(rows, null, 2))
}
