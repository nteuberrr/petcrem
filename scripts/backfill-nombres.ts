import './_env-preload'
import { getSheetData, updateById } from '../lib/datastore'
import { capitalizarNombre } from '../lib/nombres'

// ─────────────────────────────────────────────────────────────────────────────
// Backfill: normaliza a "Tipo Título" los nombres YA existentes en la base
// (clientes, veterinarios, vets de eutanasia, cotizaciones, solicitudes de
// retiro). Idempotente: solo escribe las filas cuyo nombre realmente cambia.
//
// Por seguridad corre en DRY-RUN por defecto (solo muestra). Para escribir:
//   npx tsx scripts/backfill-nombres.ts --apply
//
// Respeta DATA_BACKEND (.env.local). OJO: en producción apunta a la base real.
// ─────────────────────────────────────────────────────────────────────────────

const TARGETS: { tabla: string; campos: string[] }[] = [
  { tabla: 'clientes', campos: ['nombre_mascota', 'nombre_tutor'] },
  { tabla: 'veterinarios', campos: ['nombre', 'nombre_contacto'] },
  { tabla: 'vet_convenio_eutanasia', campos: ['nombre', 'apellido'] },
  { tabla: 'cotizaciones_eutanasia', campos: ['mascota_nombre', 'cliente_nombre', 'vet_nombre_asignado'] },
  { tabla: 'solicitudes_retiro', campos: ['cliente_nombre', 'nombre_mascota'] },
]

const apply = process.argv.includes('--apply')

async function main() {
  console.log(apply ? '⚙️  APLICANDO cambios…\n' : '🔎 DRY-RUN (no escribe). Usá --apply para guardar.\n')
  let total = 0
  for (const { tabla, campos } of TARGETS) {
    let rows: Record<string, string>[]
    try {
      rows = await getSheetData(tabla)
    } catch (e) {
      console.warn(`(salto ${tabla}: ${e instanceof Error ? e.message : e})`)
      continue
    }
    let cambios = 0
    for (const row of rows) {
      const updates: Record<string, string> = {}
      for (const campo of campos) {
        const actual = String(row[campo] ?? '')
        if (!actual.trim()) continue
        const nuevo = capitalizarNombre(actual)
        if (nuevo !== actual) updates[campo] = nuevo
      }
      if (Object.keys(updates).length === 0) continue
      cambios++
      const detalle = Object.entries(updates).map(([k, v]) => `${k}: "${row[k]}" → "${v}"`).join(' · ')
      console.log(`  [${tabla} #${row.id}] ${detalle}`)
      if (apply) {
        await updateById(tabla, row.id, { ...row, ...updates })
      }
    }
    console.log(`${tabla}: ${cambios} fila(s) ${apply ? 'actualizadas' : 'a cambiar'} (de ${rows.length})\n`)
    total += cambios
  }
  console.log(`${apply ? '✅ Listo. ' : 'DRY-RUN — '}${total} fila(s) ${apply ? 'normalizadas' : 'a normalizar'}.`)
  if (!apply && total > 0) console.log('Para aplicar:  npx tsx scripts/backfill-nombres.ts --apply')
}

main().catch(e => { console.error('❌', e); process.exit(1) })
