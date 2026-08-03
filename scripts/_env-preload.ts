/**
 * Side-effect: carga .env.local en process.env. Se importa ANTES que cualquier
 * lib que lea env al evaluarse (ej. lib/google-sheets captura SPREADSHEET_ID en
 * un const top-level). Usado por los scripts de scripts/.
 */
import { readFileSync } from 'node:fs'

const txt = readFileSync('.env.local', 'utf8')
// Ojo con el \r: se corta por /\r?\n/ y no por '\n'. En JavaScript `$` (sin flag
// /m) NO matchea antes de un \r, así que una línea guardada con final de Windows
// (CRLF) no calzaba con la regex de abajo y la variable quedaba SIN CARGAR, en
// silencio. Pasaba con cualquier variable que se editara con un editor CRLF.
for (const linea of txt.split(/\r?\n/)) {
  const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (!m) continue
  let v = m[2].trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1)
  }
  if (process.env[m[1]] === undefined) process.env[m[1]] = v
}
