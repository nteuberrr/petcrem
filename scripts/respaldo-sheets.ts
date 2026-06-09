import './_env-preload'
import { google } from 'googleapis'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Respaldo COMPLETO de la planilla (todas las pestañas) a `respaldo sheets/<timestamp>/`.
 * Guarda, por cada hoja, el arreglo crudo de valores (UNFORMATTED_VALUE, igual que
 * lo lee la app) + un _TODO.json combinado + un _manifest.json con conteos.
 *
 * Uso:  npx tsx scripts/respaldo-sheets.ts
 * (lee credenciales de .env.local vía _env-preload)
 *
 * La carpeta `respaldo sheets/` está en .gitignore (contiene datos personales).
 */

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID
if (!SPREADSHEET_ID) {
  console.error('Falta GOOGLE_SPREADSHEET_ID en el entorno')
  process.exit(1)
}

const auth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
})
const sheets = google.sheets({ version: 'v4', auth })

async function main() {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID })
  const titles = (meta.data.sheets || [])
    .map(s => s.properties?.title)
    .filter((t): t is string => !!t)

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = join(process.cwd(), 'respaldo sheets', stamp)
  mkdirSync(dir, { recursive: true })

  const manifest: { spreadsheetId: string; fecha: string; titulo?: string; hojas: Record<string, { filas: number; columnas: number }> } = {
    spreadsheetId: SPREADSHEET_ID!,
    titulo: meta.data.properties?.title ?? undefined,
    fecha: new Date().toISOString(),
    hojas: {},
  }
  const todo: Record<string, unknown[][]> = {}

  for (const title of titles) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: title,
      valueRenderOption: 'UNFORMATTED_VALUE',
    })
    const values = (res.data.values as unknown[][]) || []
    const safe = title.replace(/[^\w.-]+/g, '_')
    writeFileSync(join(dir, `${safe}.json`), JSON.stringify(values, null, 2), 'utf8')
    todo[title] = values
    manifest.hojas[title] = { filas: Math.max(0, values.length - 1), columnas: (values[0]?.length as number) || 0 }
    console.log(`  ✓ ${title}: ${Math.max(0, values.length - 1)} filas`)
  }

  writeFileSync(join(dir, '_TODO.json'), JSON.stringify(todo, null, 2), 'utf8')
  writeFileSync(join(dir, '_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

  const totalFilas = Object.values(manifest.hojas).reduce((s, h) => s + h.filas, 0)
  console.log(`\n✅ Respaldo completo: ${titles.length} hojas · ${totalFilas} filas`)
  console.log(`   Carpeta: respaldo sheets/${stamp}`)
}

main().catch(e => { console.error('❌ Error en el respaldo:', e); process.exit(1) })
