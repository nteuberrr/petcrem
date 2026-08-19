import { parseHoraTexto, parseFechaTexto, pareceRespuestaDeHora } from '../lib/eutanasia-whatsapp'

/**
 * Verifica la lectura del DÍA y la HORA que el VETERINARIO de la red de
 * eutanasias nos responde por WhatsApp ("18:30", "mañana a las 20", "20/08 6:30
 * pm"…). Es el punto frágil del flujo: de ahí salen el momento real del servicio,
 * el retiro del chofer 30 min después y el recargo fuera de horario — leerlo mal
 * desordena la agenda del día, o directamente la agenda del día equivocado.
 *
 *   npx tsx scripts/verificar-hora-vet.ts
 *
 * Reglas que se comprueban:
 *  · las horas 1–7 sin am/pm quedan AMBIGUA (se le pregunta, no se adivina);
 *  · una fecha en el mensaje NO se lee como hora ("14-08 a las 17:00" → 17:00);
 *  · sin señal clara de día, `parseFechaTexto` devuelve null y se conserva el
 *    día ya agendado (nunca se inventa un traslado).
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
  ['mañana 20/08 a las 19:30', '19:30'],
  ['lo movimos al 20 de agosto, 15:00', '15:00'],
  ['no logro contactarla', 'null'],
  ['gracias!', 'null'],
  ['ok', 'null'],
  ['5', 'AMBIGUA'],
  ['a las 7', 'AMBIGUA'],
  ['7 pm', '19:00'],
  ['7:30 am', '07:30'],
  ['25:00', 'null'],
]

// Referencia fija: martes 18-08-2026 (el script no puede depender del reloj).
const HOY = '2026-08-18'
const casosFecha: [string, string][] = [
  ['18:30', 'null'],                          // sin día → se conserva el agendado
  ['quedamos a las 19:00', 'null'],
  ['hoy a las 19:00', '2026-08-18'],
  ['mañana a las 19:00', '2026-08-19'],
  ['pasado mañana 10:00', '2026-08-20'],
  ['20/08 a las 15:00', '2026-08-20'],
  ['el 20-08 a las 15:00', '2026-08-20'],
  ['20-08-2026 15:00', '2026-08-20'],
  ['el 3 de septiembre a las 11:00', '2026-09-03'],
  ['el jueves a las 16:00', '2026-08-20'],    // jueves más próximo
  ['el martes a las 16:00', '2026-08-18'],    // hoy es martes
  ['el lunes 12:00', '2026-08-24'],
  ['31/12 a las 20:00', '2026-12-31'],
  ['gracias!', 'null'],
]

let fallos = 0
console.log('── HORA ' + '─'.repeat(50))
for (const [entrada, esperado] of casos) {
  const r = parseHoraTexto(entrada)
  const got = r === null ? 'null' : 'ambigua' in r ? 'AMBIGUA' : r.hora
  const ok = got === esperado
  if (!ok) fallos++
  console.log(`${ok ? 'OK  ' : 'FALLA'} "${entrada}" -> ${got}${ok ? '' : ` (esperaba ${esperado})`}`)
}

console.log(`\n── DÍA (hoy = ${HOY}, martes) ` + '─'.repeat(30))
for (const [entrada, esperado] of casosFecha) {
  const got = parseFechaTexto(entrada, HOY) ?? 'null'
  const ok = got === esperado
  if (!ok) fallos++
  console.log(`${ok ? 'OK  ' : 'FALLA'} "${entrada}" -> ${got}${ok ? '' : ` (esperaba ${esperado})`}`)
}

// Que un mensaje TRAIGA una hora no lo convierte en la respuesta a "dinos la
// hora": un pedido de retiro trae direccion, telefono y "13:00". Si eso se
// consumiera, se registraria como hora de la eutanasia Y le robaria el turno al
// agente, que era quien tenia que agendar el retiro (caso Daniella, 18-08).
const casosConsume: [string, boolean][] = [
  ['18:30', true],
  ['19:45', true],
  ['14:45', true],
  ['Retiro a las 17.00hrs', true],
  ['11:30 am quedo la eutanasia', true],
  ['Procedimiento a las 16:30.', true],
  ['manana 20/08 a las 19:30', true],
  ['gracias!', false],
  ['Y es sin retiro', false],
  ['Quiero solicitar un retiro de un paciente\nIvan Carmona Reyes\nPaciente: Igor, felino\n+56 9 5008 9215\nCremacion individual app 2.5kg\nElvira davila 4560, quinta normal\nRetiro para las 13.00hrs', false],
  ['Hola quiero agendar un retiro de un paciente bajo el convenio de Daniella Francisca Millas Bravo', false],
  ['Nombre tutora: Arlette Hernandez. Direccion Padre Mariano Puga 469, San Joaquin. Telefono: +56930307014', false],
]

console.log('\n── SE CONSUME COMO HORA? ' + '─'.repeat(34))
for (const [entrada, esperado] of casosConsume) {
  const got = pareceRespuestaDeHora(entrada)
  const ok = got === esperado
  if (!ok) fallos++
  const corto = entrada.replace(/\n/g, ' | ').slice(0, 60)
  console.log(`${ok ? 'OK  ' : 'FALLA'} "${corto}" -> ${got}${ok ? '' : ` (esperaba ${esperado})`}`)
}

const total = casos.length + casosFecha.length + casosConsume.length
console.log(fallos === 0 ? `\n${total}/${total} OK` : `\n${fallos} fallas`)
if (fallos > 0) process.exit(1)
