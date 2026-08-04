/**
 * Verifica el cálculo de comisiones de Ventas POS y lo contrasta contra los
 * datos reales de la base.
 *
 *   npx tsx scripts/verificar-ventas-pos.ts
 *
 * Dos partes:
 *   1. Aritmética pura (no toca la base): casos a mano con el contrato vigente
 *      — $65 + 0,79% del total cobrado, + 19% de IVA sobre esa comisión. Si un
 *      número se corre un peso, el script falla con código 1.
 *   2. Lectura real: arma el resumen del rango que se le pase y comprueba que la
 *      suma de los días cuadre con el total, y que ningún día quede con abono
 *      en sábado, domingo o feriado.
 *
 * Rango por argumentos: npx tsx scripts/verificar-ventas-pos.ts 2026-06-01 2026-08-31
 */

import './_env-preload'
import { calcularComision, resumenVentasPos, CONFIG_POS_DEFAULT, type ConfigPos } from '../lib/facturacion-pos'
import { esDiaHabil } from '../lib/dias-habiles'

let fallos = 0

function chequear(titulo: string, obtenido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtenido) === JSON.stringify(esperado)
  if (!ok) fallos++
  console.log(`${ok ? '  ok  ' : ' FALLA'} ${titulo}${ok ? '' : `\n         esperado ${JSON.stringify(esperado)}\n         obtenido ${JSON.stringify(obtenido)}`}`)
}

// ── 1. Aritmética ────────────────────────────────────────────────────────────
const cfg: ConfigPos = CONFIG_POS_DEFAULT
console.log(`Comisión = $${cfg.comision_fija} + ${cfg.comision_variable}% del total, + ${cfg.iva}% IVA\n`)

// $150.000 → 65 + 1.185 = 1.250 neto → 1.488 con IVA (1.250 × 1,19 = 1.487,5 → 1.488)
chequear('venta de $150.000', calcularComision(150000, cfg), {
  comision_neta: 1250, comision_iva: 238, comision_bruta: 1488, liquidado: 148512,
})
// $90.000 → 65 + 711 = 776 neto → 923 con IVA (776 × 1,19 = 923,44 → 923)
chequear('venta de $90.000', calcularComision(90000, cfg), {
  comision_neta: 776, comision_iva: 147, comision_bruta: 923, liquidado: 89077,
})
// Venta en $0 no debería pasar, pero el fijo igual se cobra: no puede dar negativo raro.
chequear('venta de $0 (solo el fijo)', calcularComision(0, cfg), {
  comision_neta: 65, comision_iva: 12, comision_bruta: 77, liquidado: -77,
})
// Sin comisión configurada, el líquido es la venta completa.
chequear('sin comisión', calcularComision(50000, { comision_fija: 0, comision_variable: 0, iva: 19 }), {
  comision_neta: 0, comision_iva: 0, comision_bruta: 0, liquidado: 50000,
})

// ── 2. Datos reales ──────────────────────────────────────────────────────────
async function main() {
const desde = process.argv[2] || '2026-01-01'
const hasta = process.argv[3] || '2026-12-31'
console.log(`\nResumen real ${desde} → ${hasta}`)

const r = await resumenVentasPos({ desde, hasta })
console.log(`  config en base: $${r.config.comision_fija} + ${r.config.comision_variable}% + IVA ${r.config.iva}%`)
console.log(`  ${r.dias.length} días · ${r.totales.ventas} ventas · bruto ${r.totales.bruto} · comisión ${r.totales.comision_bruta} · líquido ${r.totales.liquidado}`)
if (r.sin_fecha.length) console.log(`  ⚠ ${r.sin_fecha.length} sin fecha: ${r.sin_fecha.map(v => v.codigo).join(', ')}`)

chequear('la suma de los días cuadra con el total',
  r.dias.reduce((s, d) => s + d.liquidado, 0), r.totales.liquidado)
chequear('bruto − comisión = líquido',
  r.totales.bruto - r.totales.comision_bruta, r.totales.liquidado)

const abonoMalo = r.dias.filter(d => {
  const [y, m, dd] = d.fecha_abono.split('-').map(Number)
  return !esDiaHabil(new Date(y, m - 1, dd, 12, 0, 0))
})
chequear('ningún abono cae en día no hábil', abonoMalo.map(d => d.fecha_abono), [])

const abonoAntes = r.dias.filter(d => d.fecha_abono <= d.fecha)
chequear('el abono siempre es posterior al día de venta', abonoAntes.map(d => d.fecha), [])

for (const d of r.dias.slice(0, 5)) {
  console.log(`    ${d.fecha} → abona ${d.fecha_abono} · ${d.ventas.length} ventas · líquido ${d.liquidado}`)
}

}

main().then(() => {
  console.log(fallos === 0 ? '\nTodo cuadra.' : `\n${fallos} chequeo(s) fallaron.`)
  process.exit(fallos === 0 ? 0 : 1)
}).catch(e => { console.error(e); process.exit(1) })
