import './_env-preload'
import { cremacionLlevaRecargoFueraHorario, esFueraDeHorario } from '../lib/adicionales-auto'
import { recargoEutanasiaPara } from '../lib/eutanasia-precios'
import { horaRetiroDeEutanasia } from '../lib/agenda'

/**
 * EL RECARGO FUERA DE HORARIO: CUÁNDO APLICA Y DE QUÉ LADO VA.
 *   npx tsx scripts/verificar-recargo-fuera-horario.ts
 *
 * La regla (dueño):
 *   · Aplica SOLO si el servicio pasa de las 18:00 (o cae sábado, domingo o feriado).
 *   · Se cobra UNA SOLA VEZ por atención, nunca dos.
 *   · Cada parte responde por SU hora: eutanasia tarde → lo lleva la eutanasia;
 *     retiro tarde → lo lleva la cremación.
 *   · Si las DOS se pasan, sigue siendo UNO y lo lleva la EUTANASIA (su cobro va
 *     fuera de boleta, y se cobra igual cuando no hay cremación).
 *
 * Las dos formas de equivocarse cuestan plata y ninguna hace ruido: cobrarlo dos
 * veces (el cliente lo descubre al pagar) o ninguna (cada lado cree que lo lleva
 * el otro). Read-only: no toca la base ni envía nada.
 */

const MONTO = 10000
const HABIL = '2026-08-18'   // martes
const SABADO = '2026-08-22'

let fallas = 0
function caso(nombre: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado)
  if (!ok) fallas++
  console.log(`  ${ok ? '✅' : '❌'} ${nombre}${ok ? '' : `  → esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`}`)
}

/** Reparto real de una atención: quién cobra el recargo y cuántas veces. */
function reparto(fecha: string, horaEut: string | null, horaRetiro: string) {
  const eutCobra = horaEut ? recargoEutanasiaPara(fecha, horaEut, MONTO) > 0 : false
  const cremCobra = cremacionLlevaRecargoFueraHorario({
    retiroFueraHorario: esFueraDeHorario(fecha, horaRetiro),
    eutanasiaYaCobraRecargo: eutCobra,
  })
  return { lado: eutCobra ? 'eutanasia' : cremCobra ? 'cremación' : 'nadie', veces: (eutCobra ? 1 : 0) + (cremCobra ? 1 : 0) }
}

console.log('\n════ Solo cremación (sin eutanasia) ════')
caso('retiro 19:00 → lo cobra la cremación', reparto(HABIL, null, '19:00'), { lado: 'cremación', veces: 1 })
caso('retiro 17:30 → no hay recargo', reparto(HABIL, null, '17:30'), { lado: 'nadie', veces: 0 })
caso('sábado 11:00 → lo cobra la cremación', reparto(SABADO, null, '11:00'), { lado: 'cremación', veces: 1 })

console.log('\n════ Eutanasia + cremación ════')
caso('eutanasia 19:00 / retiro 19:30 (las dos tarde) → UNO, y lo lleva la eutanasia',
  reparto(HABIL, '19:00', '19:30'), { lado: 'eutanasia', veces: 1 })
caso('eutanasia 15:45 / retiro 19:00 (solo el retiro tarde) → lo lleva la cremación',
  reparto(HABIL, '15:45', '19:00'), { lado: 'cremación', veces: 1 })
caso('eutanasia 17:45 / retiro 18:15 (solo el retiro tarde) → lo lleva la cremación',
  reparto(HABIL, '17:45', horaRetiroDeEutanasia('17:45')), { lado: 'cremación', veces: 1 })
caso('eutanasia 15:00 / retiro 15:30 (las dos dentro) → nadie cobra',
  reparto(HABIL, '15:00', '15:30'), { lado: 'nadie', veces: 0 })
caso('eutanasia 19:00 sin cremación → lo cobra la eutanasia',
  recargoEutanasiaPara(HABIL, '19:00', MONTO), MONTO)
caso('eutanasia 15:00 sin cremación → no cobra',
  recargoEutanasiaPara(HABIL, '15:00', MONTO), 0)

console.log('\n════ Nunca dos veces ════')
for (const [hE, hR] of [['19:00', '19:30'], ['18:00', '18:30'], ['17:45', '18:15'], ['15:00', '15:30'], ['21:00', '21:30']] as [string, string][]) {
  const r = reparto(HABIL, hE, hR)
  const debe = esFueraDeHorario(HABIL, hE) || esFueraDeHorario(HABIL, hR) ? 1 : 0
  caso(`eutanasia ${hE} / retiro ${hR} → ${debe} recargo (${r.lado})`, r.veces, debe)
}

console.log('\n════ Resultado ════')
if (fallas) { console.log(`  ${fallas} caso(s) mal.\n`); process.exit(1) }
console.log('  ✅ Aplica solo pasadas las 18:00, se cobra una vez y del lado correcto.\n')
