import './_env-preload'
import { getSheetData } from '../lib/datastore'
import { fmtPrecio } from '../lib/format'

/**
 * CADA PAGO DE COMISIÓN Y SU COSTO EN EL EERR TIENEN QUE DECIR LO MISMO.
 *
 *   npx tsx scripts/verificar-comisiones-eerr.ts
 *
 * Un ajuste de saldo (Configuración → Descuentos Convenios) escribe DOS filas: la
 * del saldo (`comisiones_ajustes`) y su contrapartida de COSTO DE VENTA en el
 * Estado de Resultados (`eerr_gastos_manuales`, partida "Comisiones convenios"),
 * enlazadas por `gasto_manual_id`.
 *
 * Desde que los ajustes se pueden EDITAR y BORRAR, las dos pueden separarse: una
 * edición que mueva solo el saldo deja el EERR con otro número, y nadie se entera
 * hasta que alguien cuadra a fin de mes. Este script mira las dos puntas.
 *
 * Es de solo lectura: no corrige nada, solo muestra qué está descuadrado.
 */

const PARTIDA = 'Comisiones convenios'

let fallas = 0
const mal = (s: string) => { console.log(`  ❌ ${s}`); fallas++ }
const ok = (s: string) => console.log(`  ✅ ${s}`)

async function main() {
  const [ajustes, gastos, partidas, vets] = await Promise.all([
    getSheetData('comisiones_ajustes').catch(() => [] as Record<string, string>[]),
    getSheetData('eerr_gastos_manuales').catch(() => [] as Record<string, string>[]),
    getSheetData('eerr_partidas').catch(() => [] as Record<string, string>[]),
    getSheetData('veterinarios').catch(() => [] as Record<string, string>[]),
  ])
  const nombreVet = (id: string) => vets.find(v => String(v.id) === String(id))?.nombre || `#${id}`
  const gastoPorId = new Map(gastos.map(g => [String(g.id), g]))
  const idPartida = partidas.find(p =>
    String(p.tipo) === 'costo' && String(p.nombre).trim().toLowerCase() === PARTIDA.toLowerCase())?.id

  console.log(`\n${ajustes.length} pago(s) de comisión registrados\n`)
  if (!ajustes.length) { console.log('  (nada que revisar)\n'); return }

  console.log('  ajuste  veterinaria                    fecha        saldo        EERR')
  let sinEnlace = 0
  for (const a of ajustes) {
    const monto = parseInt(String(a.monto || '0'), 10) || 0
    const gid = String(a.gasto_manual_id || '').trim()
    const g = gid ? gastoPorId.get(gid) : undefined
    const montoG = g ? parseInt(String(g.monto || '0'), 10) || 0 : 0

    const estado = !gid ? 'sin enlace (histórico)'
      : !g ? 'EL GASTO NO EXISTE'
      : montoG !== monto ? `descuadrado: ${fmtPrecio(montoG)}`
      : String(g.fecha || '') !== String(a.fecha || '') ? `otra fecha: ${g.fecha}`
      : 'ok'

    console.log(
      `  ${String(a.id).padStart(6)}  ${nombreVet(a.veterinaria_id).slice(0, 28).padEnd(30)}`
      + ` ${String(a.fecha || '—').padEnd(12)} ${fmtPrecio(monto).padStart(11)}  ${estado}`,
    )
    if (!gid) { sinEnlace++; continue }
    if (!g) mal(`el ajuste ${a.id} apunta al gasto ${gid}, que ya no está en el EERR`)
    else if (montoG !== monto) mal(`el ajuste ${a.id} dice ${fmtPrecio(monto)} y su gasto ${gid} dice ${fmtPrecio(montoG)}`)
    else if (String(g.fecha || '') !== String(a.fecha || '')) mal(`el ajuste ${a.id} y su gasto ${gid} tienen fechas distintas`)
  }

  // Gastos de la partida SIN su ajuste: costo cargado al EERR que no descontó
  // ningún saldo. Pasa si se borra el ajuste y queda el gasto.
  if (idPartida) {
    const enlazados = new Set(ajustes.map(a => String(a.gasto_manual_id || '')).filter(Boolean))
    const huerfanos = gastos.filter(g => String(g.partida_id) === String(idPartida) && !enlazados.has(String(g.id)))
    if (huerfanos.length) {
      for (const g of huerfanos) {
        mal(`el gasto ${g.id} (${fmtPrecio(parseInt(String(g.monto || '0'), 10) || 0)}, ${g.fecha}) está en el EERR sin su pago: "${String(g.detalle || '').slice(0, 60)}"`)
      }
    }
  } else {
    console.log(`\n  (la partida "${PARTIDA}" todavía no existe: se crea con el primer pago)`)
  }

  const totalSaldo = ajustes.reduce((s, a) => s + (parseInt(String(a.monto || '0'), 10) || 0), 0)
  const totalEerr = ajustes
    .map(a => gastoPorId.get(String(a.gasto_manual_id || '')))
    .reduce((s, g) => s + (g ? parseInt(String(g.monto || '0'), 10) || 0 : 0), 0)
  console.log(`\n  total pagado según los saldos: ${fmtPrecio(totalSaldo)}`)
  console.log(`  total cargado al EERR:         ${fmtPrecio(totalEerr)}`)
  if (sinEnlace) console.log(`  (${sinEnlace} sin enlace al EERR — anteriores a que se guardara la referencia)`)

  console.log('\n════ Resultado ════')
  if (fallas) { console.log(`  ${fallas} descuadre(s).\n`); process.exit(1) }
  ok('cada pago y su costo en el Estado de Resultados coinciden')
  console.log('')
}

main().catch(e => { console.error(e); process.exit(1) })
