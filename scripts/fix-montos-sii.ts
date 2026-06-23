import './_env-preload'
import { getSheetData, updateById } from '../lib/datastore'

// Normaliza los montos de eerr_gastos_sii que quedaron guardados con separador de
// miles ('502.521' → '502521'), lo que rompía parseInt en la UI y el EERR.
// Dry-run por defecto; aplica con: npx tsx scripts/fix-montos-sii.ts --apply

const SHEET = 'eerr_gastos_sii'
const CAMPOS = ['monto_exento', 'monto_neto', 'monto_iva', 'monto_total', 'valor_otro_impuesto']

function norm(v: string | undefined): string {
  const s = (v || '').trim()
  if (s === '') return '0'
  const limpio = s.split(',')[0].replace(/[^\d-]/g, '')
  return limpio === '' || limpio === '-' ? '0' : limpio
}
// "Sucio" = tiene algún caracter que no es dígito ni signo (p.ej. el punto de miles).
const sucio = (v: string | undefined) => { const s = (v || '').trim(); return s !== '' && /[^\d-]/.test(s) }

async function main() {
  const apply = process.argv.includes('--apply')
  const rows = await getSheetData(SHEET)
  let afectadas = 0
  for (const r of rows) {
    if (!CAMPOS.some(c => sucio(r[c]))) continue
    const cambios: Record<string, string> = {}
    for (const c of CAMPOS) { const n = norm(r[c]); if (n !== (r[c] ?? '')) cambios[c] = n }
    afectadas++
    console.log(`folio ${r.folio} | ${r.razon_social}: ${Object.entries(cambios).map(([k, v]) => `${k} ${JSON.stringify(r[k])}→${v}`).join(', ')}`)
    if (apply) await updateById(SHEET, r.id, { ...r, ...cambios })
  }
  console.log(`\n${apply ? '[APLICADO]' : '[DRY-RUN]'} Facturas con montos a normalizar: ${afectadas} de ${rows.length}`)
  if (!apply && afectadas > 0) console.log('Para aplicar: npx tsx scripts/fix-montos-sii.ts --apply')
}
main().catch(e => { console.error(e); process.exit(1) })
