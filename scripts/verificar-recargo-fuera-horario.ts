import './_env-preload'
import { cremacionLlevaRecargoFueraHorario } from '../lib/adicionales-auto'
import { recargoEutanasiaPara } from '../lib/eutanasia-precios'
import { horaRetiroDeEutanasia } from '../lib/agenda'

/**
 * EL RECARGO FUERA DE HORARIO SE COBRA UNA VEZ, Y DEL LADO CORRECTO.
 *   npx tsx scripts/verificar-recargo-fuera-horario.ts
 *
 * Dos formas de equivocarse acá cuestan plata de verdad y ninguna hace ruido:
 *   · cobrarlo DOS veces (eutanasia + cremación) → el cliente lo descubre al pagar;
 *   · no cobrarlo NINGUNA (cada lado asume que lo lleva el otro) → se pierde.
 *
 * Regla vigente (dueño 2026-08-17): si la atención incluye EUTANASIA, el recargo
 * va SIEMPRE con ella —no se factura y se cobra igual sin cremación—, se pase de
 * las 18:00 la eutanasia o el retiro que la sigue. Sin eutanasia, lo lleva la
 * cremación si el retiro cae fuera de horario.
 *
 * Read-only: no toca la base ni envía nada.
 */

const MONTO = 10000
let fallas = 0
function caso(nombre: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado)
  if (!ok) fallas++
  console.log(`  ${ok ? '✅' : '❌'} ${nombre}${ok ? '' : `  → esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`}`)
}

// Un martes cualquiera (día hábil).
const HABIL = '2026-08-18'

console.log('\n════ Solo cremación (sin eutanasia) ════')
caso('retiro 19:00 → la cremación cobra el recargo',
  cremacionLlevaRecargoFueraHorario({ retiroFueraHorario: true, hayEutanasia: false }), true)
caso('retiro 15:00 → no hay recargo',
  cremacionLlevaRecargoFueraHorario({ retiroFueraHorario: false, hayEutanasia: false }), false)

console.log('\n════ Con eutanasia: la cremación NUNCA lo suma ════')
caso('retiro 19:00 + eutanasia → la cremación NO lo cobra (lo lleva la eutanasia)',
  cremacionLlevaRecargoFueraHorario({ retiroFueraHorario: true, hayEutanasia: true }), false)
caso('retiro 15:00 + eutanasia → tampoco',
  cremacionLlevaRecargoFueraHorario({ retiroFueraHorario: false, hayEutanasia: true }), false)

console.log('\n════ Del lado de la eutanasia (mira su hora Y la del retiro) ════')
caso('eutanasia 19:00 → cobra',
  recargoEutanasiaPara(HABIL, '19:00', MONTO, horaRetiroDeEutanasia('19:00')), MONTO)
caso('eutanasia 17:45 (retiro 18:15) → cobra: el retiro se pasó',
  recargoEutanasiaPara(HABIL, '17:45', MONTO, horaRetiroDeEutanasia('17:45')), MONTO)
caso('eutanasia 15:00 (retiro 15:30) → no cobra',
  recargoEutanasiaPara(HABIL, '15:00', MONTO, horaRetiroDeEutanasia('15:00')), 0)
caso('eutanasia 17:45 SIN cremación (no hay retiro) → no cobra',
  recargoEutanasiaPara(HABIL, '17:45', MONTO, undefined), 0)
caso('sábado 11:00 → cobra igual (fin de semana)',
  recargoEutanasiaPara('2026-08-22', '11:00', MONTO, horaRetiroDeEutanasia('11:00')), MONTO)

console.log('\n════ Nunca dos veces, nunca ninguna ════')
for (const [hEut, etiqueta] of [['19:00', 'las dos fuera'], ['17:45', 'eutanasia dentro, retiro fuera'], ['15:00', 'las dos dentro']] as [string, string][]) {
  const hRet = horaRetiroDeEutanasia(hEut)
  const eut = recargoEutanasiaPara(HABIL, hEut, MONTO, hRet) > 0
  const crem = cremacionLlevaRecargoFueraHorario({ retiroFueraHorario: hRet >= '18:00', hayEutanasia: true })
  const veces = (eut ? 1 : 0) + (crem ? 1 : 0)
  const esperadas = hEut >= '18:00' || hRet >= '18:00' ? 1 : 0
  caso(`eutanasia ${hEut} / retiro ${hRet} (${etiqueta}) → se cobra ${esperadas} vez(ces)`, veces, esperadas)
}

console.log('\n════ Resultado ════')
if (fallas) { console.log(`  ${fallas} caso(s) mal.\n`); process.exit(1) }
console.log('  ✅ El recargo se cobra una sola vez y siempre del lado correcto.\n')
