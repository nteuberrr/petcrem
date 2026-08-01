/**
 * Carga el histórico de liquidaciones desde las planillas del contador
 * (G:\...\RRHH\Remuneraciones\), de diciembre 2025 a julio 2026.
 *
 *   npx tsx scripts/cargar-historico-remuneraciones.ts            (simula)
 *   npx tsx scripts/cargar-historico-remuneraciones.ts --aplicar
 *
 * Los datos van transcritos acá, no leídos del Excel: las planillas son copias
 * unas de otras con celdas a medio actualizar, así que cada mes se revisó a mano
 * contra su archivo. Lo que se transcribe es la ENTRADA (sueldo base del mes,
 * cremaciones, días); los montos los recalcula el motor.
 *
 * Decisiones tomadas con el dueño:
 *  - Febrero y abril se recalculan a la META pactada. En esas planillas el Solver
 *    no se corrió y el líquido quedó por debajo de lo acordado (abril: $5.825
 *    menos a Oscar). El histórico refleja el acuerdo, no el error.
 *  - Los meses quedan como PAGADOS: su costo entra al Estado de Resultados
 *    imputado al mes devengado.
 *
 * Es idempotente: recalcular un mes pisa su liquidación (hay constraint única
 * por período y empleado).
 */
import './_env-preload'
import {
  cambiarEstadoPeriodo, guardarLiquidacion, guardarPago, listarEmpleados, listarLiquidaciones,
} from '../lib/remuneraciones/datos'
import { autocompletarPeriodo, getParametros } from '../lib/remuneraciones/parametros'
import { calendarioDelPeriodo, novedadesPorDefecto, ultimoDiaDelPeriodo } from '../lib/remuneraciones/periodo'
import { liquidar } from '../lib/remuneraciones/solver'
import type { Novedades } from '../lib/remuneraciones/tipos'

const APLICAR = process.argv.includes('--aplicar')

interface Mes {
  periodo: string
  sueldo_base: number
  cremaciones: number
  /** Días efectivamente trabajados (divisor de la semana corrida). */
  trabajados: number
  /** Domingos + festivos (multiplicador). */
  descanso: number
  /** Lo que la planilla dejó como líquido, para contrastar. */
  esperado: { oscar: number; juan: number }
  nota?: string
  /** Meses anteriores al acuerdo del variable por cremación. */
  sinVariable?: boolean
  /** Gratificación fijada a mano (diciembre la calculaba solo sobre el base). */
  gratificacion?: number
  /** Haberes imponibles sueltos, por empleado (apellido). */
  otrosImponibles?: Record<string, { nombre: string; monto: number }[]>
}

const MESES: Mes[] = [
  {
    periodo: '2025-12', sueldo_base: 529000, cremaciones: 0, trabajados: 21, descanso: 6,
    esperado: { oscar: 576752, juan: 577566 },
    sinVariable: true,
    gratificacion: 132250, // 25% del sueldo base: en 2025 no incluía el variable
    nota: 'Anterior al acuerdo del variable por cremación; la gratificación iba solo sobre el sueldo base.',
    otrosImponibles: {
      'MUÑOZ': [{ nombre: 'Otros imponibles', monto: 31022 }, { nombre: 'Semana corrida', monto: 7500 }],
      'PALENCIA': [{ nombre: 'Otros imponibles', monto: 30991 }, { nombre: 'Semana corrida', monto: 7500 }],
    },
  },
  { periodo: '2026-01', sueldo_base: 539000, cremaciones: 31, trabajados: 26, descanso: 5, esperado: { oscar: 593250, juan: 593250 } },
  { periodo: '2026-02', sueldo_base: 539000, cremaciones: 33, trabajados: 24, descanso: 4, esperado: { oscar: 596750, juan: 596750 }, nota: 'La planilla dejó a Juan $1.838 bajo la meta: se recalcula al acuerdo.' },
  { periodo: '2026-03', sueldo_base: 539000, cremaciones: 39, trabajados: 26, descanso: 5, esperado: { oscar: 607250, juan: 607250 } },
  { periodo: '2026-04', sueldo_base: 539000, cremaciones: 48, trabajados: 26, descanso: 4, esperado: { oscar: 623000, juan: 623000 }, nota: 'La planilla dejó a ambos ~$5.800 bajo la meta: se recalcula al acuerdo. Los días son los de la planilla (trabajaron Semana Santa).' },
  { periodo: '2026-05', sueldo_base: 539000, cremaciones: 33, trabajados: 24, descanso: 7, esperado: { oscar: 596750, juan: 596750 }, nota: 'Los días de la planilla (21/5) estaban heredados de otro mes y no sumaban 31: se usan los del calendario.' },
  { periodo: '2026-06', sueldo_base: 539000, cremaciones: 44, trabajados: 25, descanso: 5, esperado: { oscar: 616000, juan: 616000 }, nota: 'Ídem: la planilla traía 21/5, que no suman 30.' },
  { periodo: '2026-07', sueldo_base: 553553, cremaciones: 73, trabajados: 26, descanso: 5, esperado: { oscar: 681303, juan: 681303 } },
]

const clp = (n: number) => '$' + Math.round(n).toLocaleString('es-CL')

async function main() {
  if (!APLICAR) console.log('— Simulación (agrega --aplicar para escribir) —')

  const empleados = await listarEmpleados(false)
  if (empleados.length !== 2) {
    console.error(`❌ Esperaba 2 empleados activos y hay ${empleados.length}. Corré primero scripts/sembrar-remuneraciones.ts`)
    process.exit(1)
  }

  let problemas = 0

  for (const m of MESES) {
    console.log(`\n═══ ${m.periodo} ═══${m.nota ? `  ${m.nota}` : ''}`)

    // Parámetros del mes: se crean con la UF y la UTM de la fuente si faltan.
    let parametros = await getParametros(m.periodo)
    if (!parametros || !parametros.valor_uf || !parametros.valor_utm) {
      if (!APLICAR) { console.log('   (se crearían los parámetros del mes)'); continue }
      const r = await autocompletarPeriodo(m.periodo)
      for (const a of r.avisos) console.log(`   ⚠️ ${a}`)
      parametros = await getParametros(m.periodo)
    }
    if (!parametros?.valor_uf || !parametros?.valor_utm) {
      console.error('   ❌ Sin UF o UTM: no se puede liquidar este mes.')
      problemas++
      continue
    }

    const cal = calendarioDelPeriodo(m.periodo)
    const base = novedadesPorDefecto(m.cremaciones, cal)
    const idsGuardadas: string[] = []
    let totLiquidos = 0, totReembolsos = 0, totTransferido = 0, totCosto = 0

    for (const empleado of empleados) {
      const apellido = empleado.nombre_completo.split(' ')[0]
      const novedades: Novedades = {
        ...base,
        cremaciones: m.cremaciones,
        sueldo_base: m.sueldo_base,
        dias_efectivos: m.trabajados,
        dias_descanso: m.descanso,
        sin_variable: m.sinVariable,
        gratificacion: m.gratificacion,
        otros_imponibles: m.otrosImponibles?.[apellido] ?? [],
      }
      const { liquidacion, solver } = liquidar({ empleado, novedades, parametros })
      const t = liquidacion.totales

      const esperado = apellido.startsWith('MU') ? m.esperado.oscar : m.esperado.juan
      const delta = t.liquido - esperado
      const marca = Math.abs(delta) <= 50 ? '✅' : `⚠️ ${delta > 0 ? '+' : ''}${delta}`
      console.log(
        `   ${empleado.nombre_completo.padEnd(32)} líquido ${clp(t.liquido).padStart(10)} ` +
        `(planilla ${clp(esperado)}) ${marca}` +
        (t.reembolso_salud ? `  + reembolso ${clp(t.reembolso_salud)} = ${clp(t.total_a_transferir)}` : ''),
      )
      if (Math.abs(delta) > 50) problemas++

      totLiquidos += t.liquido
      totReembolsos += t.reembolso_salud
      totTransferido += t.total_a_transferir
      totCosto += t.costo_empresa

      if (APLICAR) {
        await guardarLiquidacion({
          periodo: m.periodo, empleado, liquidacion, solver, novedades, parametros,
          estado: 'pagada', cerradaPor: 'carga del histórico',
        })
      }
    }

    console.log(`   ${'—'.repeat(30)} transferido ${clp(totTransferido)} · costo empresa ${clp(totCosto)}`)

    if (APLICAR) {
      const fechaPago = ultimoDiaDelPeriodo(m.periodo)
      await cambiarEstadoPeriodo(m.periodo, 'pagada', { fecha_pago: fechaPago })
      for (const l of await listarLiquidaciones(m.periodo)) idsGuardadas.push(l.id)
      await guardarPago({
        periodo: m.periodo,
        liquidacion_ids: idsGuardadas,
        total_liquidos: totLiquidos,
        total_reembolsos: totReembolsos,
        total_transferido: totTransferido,
        costo_empresa: totCosto,
        fecha_pago: fechaPago,
        comentarios: `Cargado desde la planilla del contador.${m.nota ? ' ' + m.nota : ''}`,
        creado_por: 'carga del histórico',
      })
    }
  }

  console.log('')
  if (problemas) {
    console.error(`⚠️ ${problemas} línea(s) se apartan de la planilla más de $50. Revisalas antes de dar por bueno el histórico.`)
  }
  console.log(APLICAR ? '✅ Histórico cargado.' : 'Nada se escribió. Volvé a correr con --aplicar.')
}

main().catch(e => { console.error(e); process.exit(1) })
