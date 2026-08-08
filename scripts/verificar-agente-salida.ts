/**
 * Verifica la revisión final del mensaje del agente (lib/agente-salida).
 *
 *   npx tsx scripts/verificar-agente-salida.ts
 *
 * Los casos de FUGA son transcripciones LITERALES de mensajes que de verdad le
 * llegaron a clientes el 1, 4, 7 y 8 de agosto de 2026. Si alguna vez vuelven a
 * pasar, esta prueba tiene que fallar.
 */
import { revisarSalidaAgente, esRazonamientoInterno, diaDeISO } from '../lib/agente-salida'

let fallos = 0
const ok = (nombre: string, cond: boolean, detalle = '') => {
  console.log(`  ${cond ? '✔' : '✘'} ${nombre}${detalle ? ` — ${detalle}` : ''}`)
  if (!cond) fallos++
}

// ── 1. Fugas reales ──────────────────────────────────────────────────────────
console.log('\n1. Fugas de razonamiento (mensajes reales de agosto 2026)')

const FUGAS_REALES = [
  // conv #741 — la clienta del gato de 8 kg, San Ramón
  `Espera, la herramienta dice que no aplica recargo, pero hoy es sábado y según las reglas el recargo de fuera de horario aplica todo el día en fin de semana. Debo incluirlo.

Revisando: la herramienta devuelve los precios sin recargo. Pero el bloque FECHA Y HORA ACTUAL indica "RECARGO VIGENTE AHORA" por fin de semana.

Estas son las opciones para tu gato de 8 kg:

- *Cremación Individual* — $95.000`,
  // conv #740
  `Espera, la herramienta no está sumando el recargo de fin de semana, pero el bloque RECARGO VIGENTE AHORA indica que hoy es sábado y aplica el recargo de $10.000. Debo incluirlo.

Estos son los precios para una mascota de 0,5 kg en Pudahuel:`,
  // conv #738
  `Espera, la herramienta no está aplicando el recargo de fin de semana, pero según mis instrucciones, hoy es sábado y el recargo vigente aplica. Debo incluirlo.

Revisando: la herramienta dice "No aplica ningún recargo" — debo respetar lo que devuelve la herramienta.

Buenos días, Johanna.`,
  // conv #737 — pegó el texto del bloque interno tal cual
  `¡Gracias!

⚠ RECARGO VIGENTE AHORA: el próximo retiro posible cae en fin de semana → avisa el recargo de $10.000 y súmalo en TODA cotización de esta conversación.

Estos son los valores para una mascota de 4 kg:`,
  // conv #647
  `Perfecto, te cotizo la cremación para 16 kg en seguida.

Ojo: la herramienta no incluye el recargo de fin de semana porque aún no hay fecha/hora acordada, pero como hoy es sábado y el recargo vigente aplica, lo incluyo en el desglose.

Estas son las opciones:`,
]

for (const [i, txt] of FUGAS_REALES.entries()) {
  const r = revisarSalidaAgente(txt, '2026-08-08')
  const limpio = !esRazonamientoInterno(r.texto)
  ok(`caso ${i + 1}: se elimina lo interno`, limpio, limpio ? `${r.fugas.length} fragmento(s) fuera` : `QUEDÓ: ${r.texto.slice(0, 90)}`)
  ok(`caso ${i + 1}: sobrevive el mensaje al cliente`, !r.vacio && r.texto.length > 20, r.texto.split('\n')[0].slice(0, 60))
}

// ── 2. Mensajes buenos: no se tocan ──────────────────────────────────────────
console.log('\n2. Mensajes normales (no se deben modificar)')
const BUENOS = [
  'Hola, lamentamos mucho la partida de tu mascota. ¿Cuánto pesa aproximadamente y en qué comuna estás?',
  `Estos son los valores para tu gato de 8 kg:

- *Cremación Individual* — $95.000
Incluye ánfora de greda, certificado y mechón de pelo.

Como el retiro es en fin de semana, se suma un recargo por fuera de horario de $10.000.

¿Te acomoda que pasemos hoy a las 16:20?`,
  'Podemos pasar mañana a las 09:00. ¿Te sirve?',
  'La entrega es en 4 días hábiles. Te avisamos por correo cuando vayamos en camino 🐾',
]
for (const [i, txt] of BUENOS.entries()) {
  const r = revisarSalidaAgente(txt, '2026-08-08')
  ok(`bueno ${i + 1}: intacto`, r.texto === txt.trim() && r.fugas.length === 0,
    r.texto === txt.trim() ? '' : `cambió: ${r.texto.slice(0, 70)}`)
}

// ── 3. Días de la semana ─────────────────────────────────────────────────────
console.log('\n3. Días de la semana mal escritos')
// 2026-08-07 fue VIERNES; 2026-08-08, SÁBADO; 2026-08-09, DOMINGO.
ok('control: 2026-08-07 es viernes', diaDeISO('2026-08-07') === 'viernes', String(diaDeISO('2026-08-07')))

const CASOS_DIA: Array<[string, string, string]> = [
  // [texto del bot, hoyISO, fragmento que debe quedar]
  ['La fecha de entrega máxima es el *jueves 07-08-2026*, aunque puede ser antes.', '2026-08-02', 'viernes 07-08-2026'],
  ['Te esperamos el miércoles 8 de agosto a las 10:00.', '2026-08-05', 'sábado 8 de agosto'],
  ['Podemos pasar mañana viernes a las 09:00.', '2026-08-08', 'mañana domingo'],
  ['Coordinamos para hoy jueves entonces.', '2026-08-08', 'hoy sábado'],
  ['Lo dejamos para el lunes 10.', '2026-08-08', 'lunes 10'],           // correcto: no se toca
  ['Nos vemos el domingo 10.', '2026-08-08', 'lunes 10'],                // 10-08-2026 es lunes
]
for (const [txt, hoy, esperado] of CASOS_DIA) {
  const r = revisarSalidaAgente(txt, hoy)
  ok(`"${txt.slice(0, 46)}…"`, r.texto.includes(esperado), `→ ${r.texto}`)
}

// ── 4. Solo razonamiento → escalar ───────────────────────────────────────────
console.log('\n4. Si NO queda mensaje utilizable, hay que escalar')
{
  const r = revisarSalidaAgente('Hmm, la herramienta dice que no aplica recargo. Debo confiar en la herramienta.', '2026-08-08')
  ok('marca vacio=true', r.vacio, `quedó "${r.texto}"`)
}

// ── 5. Horas no se rompen ────────────────────────────────────────────────────
console.log('\n5. Las horas no se confunden con fechas')
{
  const txt = 'Tenemos disponible hoy a las 16:20, 17:05 y 21:10.'
  const r = revisarSalidaAgente(txt, '2026-08-08')
  ok('texto con horas intacto', r.texto === txt, r.texto)
}

console.log(fallos === 0 ? '\n✅ La revisión de salida funciona.\n' : `\n❌ ${fallos} fallo(s).\n`)
process.exit(fallos ? 1 : 0)
