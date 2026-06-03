// Lee el xlsx local y reporta hojas, headers, primeras filas y conteos.
// Uso: node scripts/inspect-vets-xlsx.mjs
import XLSX from 'xlsx-js-style'
import fs from 'fs'

const FILE = 'G:/Mi unidad/2. Industrias NC/Veterinarios/Base de datos veterinarios.xlsx'

if (!fs.existsSync(FILE)) {
  console.error(`No existe: ${FILE}`)
  process.exit(1)
}

const buf = fs.readFileSync(FILE)
const wb = XLSX.read(buf, { type: 'buffer' })

console.log('Hojas:', wb.SheetNames)
console.log('')

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  console.log(`── Hoja "${name}" ─ ${rows.length} filas`)
  if (rows.length === 0) continue
  console.log('Headers:', rows[0])
  const sample = rows.slice(1, 6)
  console.log(`Muestra (primeras ${sample.length} filas):`)
  for (let i = 0; i < sample.length; i++) {
    const obj = {}
    rows[0].forEach((h, j) => { obj[h || `col${j}`] = sample[i][j] })
    console.log(`  [${i + 1}]`, obj)
  }
  console.log('')
}
