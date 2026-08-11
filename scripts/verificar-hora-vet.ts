import { parseHoraTexto } from '../lib/eutanasia-whatsapp'

/**
 * Verifica la lectura de la hora que el VETERINARIO de la red de eutanasias nos
 * responde por WhatsApp ("18:30", "a las 20", "6:30 pm"…). Es el punto frágil del
 * flujo: de esa hora salen la hora real del servicio, el retiro del chofer 30 min
 * después y el recargo fuera de horario — leerla mal desordena la agenda del día.
 *
 *   npx tsx scripts/verificar-hora-vet.ts
 *
 * Las horas 1–7 sin am/pm deben quedar AMBIGUA (se le pregunta, no se adivina).
 */

const casos: [string, string][] = [
  ['18:30', '18:30'],
  ['18.30', '18:30'],
  ['a las 20', '20:00'],
  ['quedamos a las 19:00', '19:00'],
  ['19 hrs', '19:00'],
  ['19hrs', '19:00'],
  ['20:15 hrs', '20:15'],
  ['Hola, quedó para las 21:00', '21:00'],
  ['6:30 pm', '18:30'],
  ['8 pm', '20:00'],
  ['12:00', '12:00'],
  ['09:45', '09:45'],
  ['a las 10 de la mañana', '10:00'],
  ['23:59', '23:59'],
  ['00:30', '00:30'],
  ['puede ser el 14-08 a las 17:00', '17:00'],
  ['no logro contactarla', 'null'],
  ['gracias!', 'null'],
  ['ok', 'null'],
  ['5', 'AMBIGUA'],
  ['a las 7', 'AMBIGUA'],
  ['7 pm', '19:00'],
  ['7:30 am', '07:30'],
  ['25:00', 'null'],
]

let fallos = 0
for (const [entrada, esperado] of casos) {
  const r = parseHoraTexto(entrada)
  const got = r === null ? 'null' : 'ambigua' in r ? 'AMBIGUA' : r.hora
  const ok = got === esperado
  if (!ok) fallos++
  console.log(`${ok ? 'OK  ' : 'FALLA'} "${entrada}" -> ${got}${ok ? '' : ` (esperaba ${esperado})`}`)
}
console.log(fallos === 0 ? `\n${casos.length}/${casos.length} OK` : `\n${fallos} fallas`)
if (fallos > 0) process.exit(1)
