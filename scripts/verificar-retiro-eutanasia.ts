import { calcularRetiroTrasEutanasia, horaRetiroDeEutanasia, type RangoBloqueado } from '../lib/agenda'

/**
 * Verifica la regla del RETIRO que sigue a una eutanasia CON cremación
 * (`calcularRetiroTrasEutanasia`, el núcleo puro de lib/agenda).
 *
 * La regla: el retiro sale 30 min después del procedimiento; si esa media hora
 * está topada por otro retiro o por un bloqueo manual, se corre al primer
 * horario hábil LIBRE posterior — nunca antes (el chofer no puede pasar mientras
 * el veterinario está trabajando). La eutanasia en sí no ocupa agenda.
 *
 * Debe seguir pasando ante cualquier cambio de la separación entre servicios.
 * Uso:  npx tsx scripts/verificar-retiro-eutanasia.ts
 */

const hm = (h: string) => parseInt(h.slice(0, 2), 10) * 60 + parseInt(h.slice(3, 5), 10)

interface Caso {
  nombre: string
  eutanasia: string
  ocupadas: string[]
  bloqueos?: { desde: string; hasta: string }[]
  espera: string
  desplazado: boolean
  sinHueco?: boolean
}

const CASOS: Caso[] = [
  {
    nombre: 'Día libre → el retiro sale 30 min después',
    eutanasia: '17:00', ocupadas: [], espera: '17:30', desplazado: false,
  },
  {
    // El caso que planteó el dueño: eutanasia 17:00 → retiro natural 17:30, pero
    // un retiro a las 17:15 lo tapa; el primer hueco es 18:00.
    nombre: 'Topado por un retiro a las 17:15 → se corre a las 18:00',
    eutanasia: '17:00', ocupadas: ['17:15'], espera: '18:00', desplazado: true,
  },
  {
    nombre: 'Tope encadenado (17:15 y 18:00) → se corre a las 18:45',
    eutanasia: '17:00', ocupadas: ['17:15', '18:00'], espera: '18:45', desplazado: true,
  },
  {
    nombre: 'Una reserva lejana no estorba',
    eutanasia: '10:00', ocupadas: ['15:00'], espera: '10:30', desplazado: false,
  },
  {
    // Nunca se adelanta, aunque la mañana esté vacía.
    nombre: 'No se adelanta: el corrimiento es siempre hacia adelante',
    eutanasia: '19:00', ocupadas: ['19:30'], espera: '20:15', desplazado: true,
  },
  {
    nombre: 'Un bloqueo manual también corre el retiro',
    eutanasia: '11:00', ocupadas: [], bloqueos: [{ desde: '11:00', hasta: '13:00' }],
    espera: '13:00', desplazado: true,
  },
  {
    // Sin hueco hasta el corte de las 21:10: se deja la base y lo resuelve el equipo.
    nombre: 'Sin hueco hasta el cierre → queda la base, marcado para el equipo',
    eutanasia: '20:50', ocupadas: ['21:00'], espera: '21:20', desplazado: false, sinHueco: true,
  },
]

function main() {
  let fallos = 0
  for (const c of CASOS) {
    const rangos: RangoBloqueado[] = (c.bloqueos || []).map((b, i) => ({
      ini: hm(b.desde), fin: hm(b.hasta), motivo: '', id: `b${i}`,
    }))
    const r = calcularRetiroTrasEutanasia(horaRetiroDeEutanasia(c.eutanasia), c.ocupadas.map(hm), rangos)
    const ok = r.hora === c.espera
      && r.desplazado === c.desplazado
      && !!r.sinHueco === !!c.sinHueco
    if (!ok) fallos++
    console.log(`${ok ? 'OK   ' : 'FALLA'} ${c.nombre}`)
    if (!ok) {
      console.log(`      eutanasia ${c.eutanasia} · ocupadas [${c.ocupadas.join(', ') || '—'}]`)
      console.log(`      esperado ${c.espera} (desplazado=${c.desplazado}, sinHueco=${!!c.sinHueco})`)
      console.log(`      obtenido ${r.hora} (desplazado=${r.desplazado}, sinHueco=${!!r.sinHueco})`)
    }
  }
  console.log(fallos === 0 ? `\n${CASOS.length} casos, todos pasan.` : `\n${fallos} caso(s) fallando.`)
  if (fallos > 0) process.exitCode = 1
}

main()
