import { yaFueRetirada, retiroPendiente, fichaIngresada } from '../lib/ficha-retiro'

/**
 * DOS preguntas parecidas que NO son la misma, y por eso son dos funciones:
 *
 *  · `fichaIngresada` — "¿el equipo ya la dio por recibida?". Es el registro de
 *    la ficha (código + correo al tutor) y es lo que pinta la agenda de AZUL.
 *  · `yaFueRetirada`  — "¿la mascota está FÍSICAMENTE acá?". Decide si un
 *    adicional lo cobra el chofer en la puerta o se manda por transferencia, y
 *    por eso es más estricta: la ficha que el equipo deja lista ANTES de salir
 *    no cuenta (caso Channel, 28-07-2026, donde eso le mandó al tutor un cobro
 *    que el chofer iba a hacer en persona).
 *
 *   npx tsx scripts/verificar-ya-retirada.ts
 *
 * Son funciones PURAS: esto corre sin tocar la base ni el reloj real.
 */

const AHORA = { iso: '2026-08-19', min: 12 * 60 }   // 19-08-2026, 12:00 en Chile

interface Caso {
  nombre: string
  ficha: { codigo?: string; estado?: string; fecha_retiro?: string; hora_retiro?: string; peso_ingreso?: string }
  /** ¿La agenda la pinta de azul? */
  ingresada: boolean
  /** ¿Está físicamente acá (cobro del adicional)? */
  esperado: boolean
}

const CASOS: Caso[] = [
  {
    nombre: 'borrador del bot (sin código): nunca está con nosotros',
    ficha: { codigo: '', estado: 'borrador', fecha_retiro: '2026-08-18', hora_retiro: '10:00', peso_ingreso: '5' },
    ingresada: false, esperado: false,
  },
  {
    nombre: 'registrada, retiro de ayer',
    ficha: { codigo: 'P100-CI', estado: 'pendiente', fecha_retiro: '2026-08-18', hora_retiro: '10:00' },
    ingresada: true, esperado: true,
  },
  {
    nombre: 'registrada, retiro HOY más temprano',
    ficha: { codigo: 'P101-CI', estado: 'pendiente', fecha_retiro: '2026-08-19', hora_retiro: '10:00' },
    ingresada: true, esperado: true,
  },
  {
    nombre: 'registrada, retiro HOY más tarde y SIN pesar → ficha preparada antes de salir (Channel)',
    ficha: { codigo: 'P102-CI', estado: 'pendiente', fecha_retiro: '2026-08-19', hora_retiro: '18:00' },
    ingresada: true, esperado: false,
  },
  {
    nombre: 'registrada, retiro HOY más tarde pero YA PESADA → el retiro se adelantó',
    ficha: { codigo: 'P103-CI', estado: 'pendiente', fecha_retiro: '2026-08-19', hora_retiro: '18:00', peso_ingreso: '12.4' },
    ingresada: true, esperado: true,
  },
  {
    nombre: 'registrada, retiro MAÑANA y ya pesada → también está acá',
    ficha: { codigo: 'P104-CI', estado: 'pendiente', fecha_retiro: '2026-08-20', hora_retiro: '09:00', peso_ingreso: '3' },
    ingresada: true, esperado: true,
  },
  {
    nombre: 'registrada, retiro MAÑANA sin pesar → todavía no',
    ficha: { codigo: 'P105-CI', estado: 'pendiente', fecha_retiro: '2026-08-20', hora_retiro: '09:00' },
    ingresada: true, esperado: false,
  },
  {
    nombre: 'peso en 0 no cuenta como pesada',
    ficha: { codigo: 'P106-CI', estado: 'pendiente', fecha_retiro: '2026-08-19', hora_retiro: '18:00', peso_ingreso: '0' },
    ingresada: true, esperado: false,
  },
  {
    nombre: 'peso con coma decimal (así lo escribe el equipo)',
    ficha: { codigo: 'P107-CI', estado: 'pendiente', fecha_retiro: '2026-08-19', hora_retiro: '18:00', peso_ingreso: '2,8' },
    ingresada: true, esperado: true,
  },
  {
    nombre: 'sin fecha de retiro (fichas viejas): se asume que ya pasó',
    ficha: { codigo: 'P108-CI', estado: 'pendiente', fecha_retiro: '', hora_retiro: '' },
    ingresada: true, esperado: true,
  },
  {
    nombre: 'ya cremada: obviamente está con nosotros',
    ficha: { codigo: 'P109-CI', estado: 'cremado', fecha_retiro: '2026-08-19', hora_retiro: '20:00', peso_ingreso: '7' },
    ingresada: true, esperado: true,
  },
]

let fallos = 0
console.log('  agenda │ físico │ caso')
for (const c of CASOS) {
  const ing = fichaIngresada(c.ficha)
  const fis = yaFueRetirada(c.ficha, AHORA)
  const okI = ing === c.ingresada
  const okF = fis === c.esperado
  if (!okI || !okF) fallos++
  const col = (v: boolean, ok: boolean, si: string, no: string) => (ok ? (v ? si : no) : ' FALLA')
  console.log(`  ${col(ing, okI, ' AZUL ', 'verde ')} │ ${col(fis, okF, ' acá  ', ' viene')} │ ${c.nombre}`)
  if (!okI) console.log(`         ↑ fichaIngresada dio ${ing}, se esperaba ${c.ingresada}`)
  if (!okF) console.log(`         ↑ yaFueRetirada dio ${fis}, se esperaba ${c.esperado}`)
}

// `retiroPendiente` es el complemento y NO mira el peso a propósito: responde
// "¿falta que pase el retiro agendado?", que es una pregunta de calendario.
const pend = retiroPendiente({ fecha_retiro: '2026-08-19', hora_retiro: '18:00' }, AHORA)
if (!pend) { fallos++; console.log('FALLA retiroPendiente debería seguir siendo true para un retiro de hoy a las 18:00') }
else console.log('OK   retiroPendiente sigue mirando solo el calendario')

console.log(fallos === 0 ? `\n${CASOS.length + 1}/${CASOS.length + 1} OK` : `\n${fallos} fallas`)
if (fallos > 0) process.exit(1)
