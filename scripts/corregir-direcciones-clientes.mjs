// Corrige direcciones (retiro + despacho) de clientes no despachados usando Geocoding API.
// Hace dry-run por defecto. Para aplicar de verdad: node scripts/corregir-direcciones-clientes.mjs --apply
// Necesita en .env.local: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SPREADSHEET_ID, GOOGLE_MAPS_API_KEY

import { google } from 'googleapis'

const APPLY = process.argv.includes('--apply')

function getSheets() {
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  return google.sheets({ version: 'v4', auth })
}

async function getAllRows(sheets, spreadsheetId, sheetName) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId, range: sheetName, valueRenderOption: 'UNFORMATTED_VALUE',
  })
  const rows = res.data.values || []
  if (rows.length < 2) return { headers: [], rows: [] }
  const headers = rows[0]
  const objs = rows.slice(1).map(r => {
    const o = {}
    headers.forEach((h, i) => { o[h] = r[i] != null ? String(r[i]) : '' })
    return o
  })
  return { headers, rows: objs }
}

function colLetter(n) {
  // n es 1-indexed: 1=A, 26=Z, 27=AA, ...
  let s = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

async function updateCells(sheets, spreadsheetId, sheetName, rowIndex0, headers, data) {
  const sheetRow = rowIndex0 + 2
  const values = headers.map(h => data[h] != null ? String(data[h]) : '')
  const endCol = colLetter(headers.length)
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A${sheetRow}:${endCol}${sheetRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] },
  })
}

async function geocode(direccion, comuna, key) {
  if (!direccion || !direccion.trim()) return null
  const query = comuna ? `${direccion.trim()}, ${comuna.trim()}, Chile` : `${direccion.trim()}, Chile`
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
  url.searchParams.set('address', query)
  url.searchParams.set('region', 'cl')
  url.searchParams.set('language', 'es')
  url.searchParams.set('key', key)
  const r = await fetch(url.toString())
  const j = await r.json()
  if (j.status !== 'OK' || !j.results?.[0]) return null
  return {
    formatted: j.results[0].formatted_address,
    location_type: j.results[0].geometry.location_type,
    lat: j.results[0].geometry.location.lat,
    lng: j.results[0].geometry.location.lng,
  }
}

function norm(s) {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,]/g, '')
}

const MARCADORES_NO_VALIDO = new Set([
  'no registra', 'nr', '0', '-', '--', 'sin', 'sin direccion', 'sin dirección',
  'no aplica', 'n/a', 'na', '.', '..', 'x', 'xx', 'ninguna', 'ninguno',
])

function esOriginalNoValido(s) {
  const n = norm(s)
  if (!n) return true
  if (MARCADORES_NO_VALIDO.has(n)) return true
  if (/^[0-9]+$/.test(n)) return true  // solo dígitos
  // Empieza con "veterinaria" o "vet " — es un nombre de local, no una dirección
  if (/^vet(erinaria)?\b/.test(n)) return true
  return false
}

function esGeocodingDebil(geo) {
  if (geo.location_type === 'APPROXIMATE') return true
  // Si el resultado es solo "Chile" o solo una región, es basura
  const partes = geo.formatted.split(',').map(p => p.trim()).filter(Boolean)
  if (partes.length <= 2) return true  // ej: "Santiago, Chile" o "Chile"
  // Si la primera parte no tiene un número, no es una dirección de calle
  if (!/\d/.test(partes[0])) return true
  return false
}

async function main() {
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY
  if (!spreadsheetId || !mapsKey) {
    console.error('Faltan envs.'); process.exit(1)
  }
  const sheets = getSheets()
  const { headers, rows } = await getAllRows(sheets, spreadsheetId, 'clientes')

  console.log(`\n${APPLY ? '🔴 APPLY MODE' : '🟡 DRY RUN'} — revisando ${rows.length} clientes...\n`)

  const cambios = []
  const sinResultado = []
  const skippedNoValido = []
  const skippedDebil = []
  let revisados = 0

  for (let i = 0; i < rows.length; i++) {
    const c = rows[i]
    if (c.estado === 'despachado') continue
    revisados++

    for (const campo of ['direccion_retiro', 'direccion_despacho']) {
      const original = (c[campo] || '').trim()
      if (!original) continue

      // Skip si el original es un marcador "no aplica" — no queremos sobreescribirlo con basura
      if (esOriginalNoValido(original)) {
        skippedNoValido.push({ codigo: c.codigo, campo, valor: original })
        continue
      }

      const geo = await geocode(original, c.comuna || '', mapsKey)
      if (!geo) {
        sinResultado.push({ codigo: c.codigo, campo, valor: original })
        continue
      }

      // Skip si el resultado es débil (APPROXIMATE, solo "Chile", etc.)
      if (esGeocodingDebil(geo)) {
        skippedDebil.push({ codigo: c.codigo, campo, valor: original, resultado: geo.formatted, location_type: geo.location_type })
        continue
      }

      if (norm(geo.formatted) === norm(original)) continue

      cambios.push({
        rowIndex: i,
        id: c.id,
        codigo: c.codigo,
        nombre_mascota: c.nombre_mascota,
        campo,
        original,
        corregida: geo.formatted,
        location_type: geo.location_type,
      })

      if (APPLY) {
        c[campo] = geo.formatted
        await updateCells(sheets, spreadsheetId, 'clientes', i, headers, c)
      }
    }
  }

  console.log(`Revisados:           ${revisados}`)
  console.log(`Cambios a aplicar:   ${cambios.length}`)
  console.log(`  retiro:            ${cambios.filter(c => c.campo === 'direccion_retiro').length}`)
  console.log(`  despacho:          ${cambios.filter(c => c.campo === 'direccion_despacho').length}`)
  console.log(`Skipped (marcador):  ${skippedNoValido.length}  (originales tipo "No registra", "0", etc — no se tocan)`)
  console.log(`Skipped (resultado): ${skippedDebil.length}  (Google devolvió algo demasiado genérico)`)
  console.log(`Sin geocoding:       ${sinResultado.length}\n`)

  if (cambios.length > 0) {
    console.log('=== CAMBIOS ===')
    cambios.forEach(c => {
      console.log(`[${c.codigo}] ${c.nombre_mascota} · ${c.campo} (${c.location_type})`)
      console.log(`  ANTES:    ${c.original}`)
      console.log(`  DESPUES:  ${c.corregida}`)
    })
  }

  if (skippedDebil.length > 0) {
    console.log('\n=== SKIPPED por resultado débil (no se aplica) ===')
    skippedDebil.forEach(s => console.log(`[${s.codigo}] ${s.campo}: "${s.valor}" → "${s.resultado}" (${s.location_type})`))
  }

  if (skippedNoValido.length > 0) {
    console.log('\n=== SKIPPED por marcador no válido ===')
    skippedNoValido.forEach(s => console.log(`[${s.codigo}] ${s.campo}: "${s.valor}"`))
  }

  if (sinResultado.length > 0) {
    console.log('\n=== SIN GEOCODING ===')
    sinResultado.forEach(s => console.log(`[${s.codigo}] ${s.campo}: ${s.valor}`))
  }

  if (!APPLY && cambios.length > 0) {
    console.log('\n⚠️  Esto fue dry-run. Para aplicar de verdad: node scripts/corregir-direcciones-clientes.mjs --apply')
  }
}

main().catch(e => { console.error(e); process.exit(1) })
