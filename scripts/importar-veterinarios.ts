/**
 * Importa veterinarias desde un .xlsx a la hoja `veterinarios`, con
 * tipo_precios = 'precios_convenio'. NO envía el correo de bienvenida (usa
 * appendRow directo, no el endpoint). Dedup por NOMBRE contra lo ya existente.
 *
 *   npx tsx scripts/importar-veterinarios.ts "<ruta.xlsx>" [--dry]
 *
 * Columnas esperadas (fila de encabezado):
 *   Nombre | Razon Social | Giro | Dirección | Comuna | Teléfono | Correo |
 *   Nombre Contacto | Cargo Contacto
 */
import './_env-preload' // DEBE ir primero: carga env antes de evaluar las libs
import * as XLSX from 'xlsx-js-style'
import { getSheetData, appendRow, getNextId } from '../lib/datastore'
import { todayISO } from '../lib/dates'

const path = process.argv[2]
const DRY = process.argv.includes('--dry')

const str = (v: unknown): string => (v == null ? '' : String(v).trim())
const tel = (v: unknown): string => { const d = String(v ?? '').replace(/\D/g, ''); return d ? `+${d}` : '' }

async function main() {
  if (!path) { console.error('Uso: npx tsx scripts/importar-veterinarios.ts "<ruta.xlsx>" [--dry]'); process.exit(1) }
  const wb = XLSX.readFile(path)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })

  const existentes = await getSheetData('veterinarios')
  const existeNombre = new Set(existentes.map(v => str(v.nombre).toLowerCase()).filter(Boolean))

  // Pedimos el id FRESCO por fila (getNextId = nextval): la secuencia identity
  // avanza con cada insert y nunca queda detrás de max(id). En DRY NO llamamos a
  // getNextId, así no avanzamos la secuencia en una corrida de prueba.
  let creados = 0, saltados = 0
  for (const r of rows) {
    const nombre = str(r['Nombre'])
    if (!nombre) continue
    if (existeNombre.has(nombre.toLowerCase())) {
      console.log(`  – saltado (ya existe): ${nombre}`); saltados++; continue
    }
    const base = {
      nombre,
      rut: '',
      razon_social: str(r['Razon Social']),
      giro: str(r['Giro']),
      direccion: str(r['Dirección']),
      comuna: str(r['Comuna']),
      telefono: tel(r['Teléfono']),
      correo: str(r['Correo']),
      nombre_contacto: str(r['Nombre Contacto']),
      cargo_contacto: str(r['Cargo Contacto']),
      tipo_precios: 'precios_convenio',
      precios_especiales: '',
      activo: 'TRUE',
      fecha_creacion: todayISO(),
    }
    if (DRY) {
      console.log(`  [dry] crearía: ${nombre} · ${base.comuna} · ${base.correo} · convenio`)
    } else {
      const id = await getNextId('veterinarios')
      await appendRow('veterinarios', { id, ...base })
      console.log(`  ✓ creado id ${id}: ${nombre} · ${base.comuna} · convenio`)
    }
    existeNombre.add(nombre.toLowerCase())
    creados++
  }
  console.log(`\n${DRY ? '[DRY] ' : ''}Total: ${creados} a crear/creados, ${saltados} saltados.`)
}

main().catch(e => { console.error('ERROR:', e instanceof Error ? e.message : e); process.exit(1) })
