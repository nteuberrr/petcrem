/**
 * Side-effect: carga .env.local en process.env. Se importa ANTES que cualquier
 * lib que lea env al evaluarse (ej. lib/google-sheets captura SPREADSHEET_ID en
 * un const top-level). Usado por los scripts de scripts/.
 */
import { readFileSync } from 'node:fs'

const txt = readFileSync('.env.local', 'utf8')
for (const linea of txt.split('\n')) {
  const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (!m) continue
  let v = m[2].trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1)
  }
  if (process.env[m[1]] === undefined) process.env[m[1]] = v
}
