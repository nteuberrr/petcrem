/**
 * Verifica el motor de remuneraciones contra los números REALES de la planilla
 * de julio 2026 (la que se calculaba a mano con el Solver de Excel).
 *
 *   npx tsx scripts/verificar-remuneraciones.ts
 *
 * No toca la base de datos: el motor es puro. Si algún número se corre un peso,
 * el script falla con código 1 y muestra qué línea cambió.
 *
 * ⚠️ La planilla venía de copiar la del mes anterior, así que varias celdas
 * quedaron sin actualizar: traía la UF y la UTM de JUNIO y un calendario de
 * 21 días hábiles / 5 de descanso que no es el de julio (22/5). Precisamente por
 * eso el módulo trae los indicadores solo y calcula los días del almanaque.
 *
 * Acá se reproduce la planilla TAL COMO ESTABA — es lo único contra lo que se
 * puede contrastar el motor — pero se corre dos veces: con los indicadores que
 * traía y con los verdaderos de julio. Si el líquido cambiara entre una y otra,
 * el error de la planilla habría costado plata.
 */

import { liquidar, metaLiquido } from '../lib/remuneraciones/solver'
import { parametrosPorDefecto } from '../lib/remuneraciones/tablas'
import type { EmpleadoCalculo, Novedades, Parametros } from '../lib/remuneraciones/tipos'

const PERIODO = '2026-07'

/** Los indicadores que traía la planilla: son los de junio, quedaron sin actualizar. */
const parametros: Parametros = {
  ...parametrosPorDefecto(PERIODO),
  valor_uf: 40820.31,
  valor_utm: 71506,
}

/** Los que de verdad corresponden a julio 2026 (UF del 31, UTM del mes). */
const parametrosReales: Parametros = {
  ...parametrosPorDefecto(PERIODO),
  valor_uf: 40844.79,
  valor_utm: 71649,
}

// Los días que traía la planilla, también heredados: julio 2026 tiene 22 hábiles.
const novedades: Novedades = {
  cremaciones: 44,
  dias_trabajados: 30,
  dias_efectivos: 21,
  dias_descanso: 5,
  horas_extra: 0,
  otros_imponibles: [],
  otros_no_imponibles: [],
  otros_descuentos: [],
  anticipos: 0,
}

const comun = {
  tipo_contrato: 'plazo_fijo' as const,
  jornada_semanal_horas: 42,
  sueldo_base: 539000,
  modalidad_variable: 'meta_liquido' as const,
  valor_por_cremacion: 1750,
  plan_salud_uf: 0,
  apv_monto: 0,
  haberes_no_imponibles: [],
}

const oscar: EmpleadoCalculo = {
  ...comun,
  nombre_completo: 'MUÑOZ SOTO OSCAR NEFTALÍ',
  rut: '19.381.790-4',
  cargo: 'CHOFER',
  afp: 'modelo',
  prevision_salud: 'fonasa',
}

const juan: EmpleadoCalculo = {
  ...comun,
  nombre_completo: 'PALENCIA RODRIGUEZ JUAN MIGUEL',
  rut: '28.842.662-7',
  cargo: 'OPERARIO',
  afp: 'uno',
  prevision_salud: 'no_tiene',
}

/**
 * Lo que dice la planilla de junio, celda por celda. Cada control es
 * [clave, mínimo, máximo]; con mínimo = máximo se exige el valor exacto.
 */
const ESPERADO: Record<string, [string, number, number][]> = {
  'MUÑOZ SOTO OSCAR NEFTALÍ': [
    ['variable_imponible', 47583, 47583],
    ['total_imponible', 747391, 747391],
    ['afp', 79074, 79074],
    ['salud', 52317, 52317],
    ['total_descuentos', 131391, 131391],
    ['liquido', 616000, 616000],
    ['reembolso_salud', 0, 0],
  ],
  'PALENCIA RODRIGUEZ JUAN MIGUEL': [
    // El Excel calculaba la semana corrida de Juan sobre el variable NETO y la
    // de Oscar sobre el imponible (inconsistencia entre hojas). El motor las
    // unifica sobre el imponible, así que su imponible no coincide al peso con
    // el del Excel — pero el líquido, que es lo pactado, sí.
    //
    // Además no existe un bono ENTERO que le deje el líquido en $616.000
    // clavados: el Excel lo lograba con decimales de peso. El motor toma el
    // menor bono que alcanza la meta y reporta la diferencia; el control es que
    // nunca quede por debajo de lo pactado y que el exceso sea despreciable.
    ['liquido', 616000, 616050],
    ['salud', 52200, 52300],
    ['reembolso_salud', 52200, 52300],
  ],
}

let fallas = 0

for (const empleado of [oscar, juan]) {
  const { liquidacion, solver } = liquidar({ empleado, novedades, parametros })
  const t = liquidacion.totales
  const meta = metaLiquido(empleado, novedades)

  console.log(`\n═══ ${empleado.nombre_completo} — ${PERIODO} ═══`)
  console.log(`Meta de líquido: $${meta.toLocaleString('es-CL')} (539.000 + 1.750 × ${novedades.cremaciones})`)
  console.log('\nHABERES IMPONIBLES')
  for (const l of liquidacion.haberes.imponibles) {
    console.log(`  ${l.etiqueta.padEnd(34)} $${String(l.monto.toLocaleString('es-CL')).padStart(11)}   ${l.formula ?? ''}`)
  }
  console.log(`  ${'TOTAL IMPONIBLE'.padEnd(34)} $${String(t.total_imponible.toLocaleString('es-CL')).padStart(11)}`)
  console.log('\nDESCUENTOS')
  for (const l of [...liquidacion.descuentos.legales, ...liquidacion.descuentos.otros]) {
    console.log(`  ${l.etiqueta.padEnd(34)} $${String(l.monto.toLocaleString('es-CL')).padStart(11)}   ${l.formula ?? ''}`)
  }
  console.log(`  ${'TOTAL DESCUENTOS'.padEnd(34)} $${String(t.total_descuentos.toLocaleString('es-CL')).padStart(11)}`)
  console.log(`\n  ${'LÍQUIDO A PAGO'.padEnd(34)} $${String(t.liquido.toLocaleString('es-CL')).padStart(11)}`)
  if (t.reembolso_salud) {
    console.log(`  ${'+ Reembolso de salud'.padEnd(34)} $${String(t.reembolso_salud.toLocaleString('es-CL')).padStart(11)}`)
    console.log(`  ${'= TOTAL A TRANSFERIR'.padEnd(34)} $${String(t.total_a_transferir.toLocaleString('es-CL')).padStart(11)}`)
  }
  console.log('\nAPORTE EMPLEADOR')
  for (const l of liquidacion.aportes_empleador) {
    console.log(`  ${l.etiqueta.padEnd(34)} $${String(l.monto.toLocaleString('es-CL')).padStart(11)}   ${l.formula ?? ''}`)
  }
  console.log(`  ${'COSTO EMPRESA'.padEnd(34)} $${String(t.costo_empresa.toLocaleString('es-CL')).padStart(11)}`)
  if (solver) {
    console.log(`\nSolver: bono $${solver.variable_imponible.toLocaleString('es-CL')} → líquido $${solver.liquido.toLocaleString('es-CL')} ` +
      (solver.exacto ? '(exacto ✅)' : `(+$${solver.diferencia} sobre la meta ⚠️)`))
  }

  // ── Contraste con la planilla ───────────────────────────────────────────
  const controles = ESPERADO[empleado.nombre_completo] || []
  const obtenido: Record<string, number> = {
    variable_imponible: t.variable_imponible,
    total_imponible: t.total_imponible,
    afp: liquidacion.descuentos.legales.find(l => l.etiqueta.startsWith('AFP'))?.monto ?? 0,
    salud: liquidacion.descuentos.legales.find(l => /FONASA|ISAPRE|SALUD/.test(l.etiqueta))?.monto ?? 0,
    total_descuentos: t.total_descuentos,
    liquido: t.liquido,
    reembolso_salud: t.reembolso_salud,
  }
  for (const [clave, minimo, maximo] of controles) {
    const valor = obtenido[clave] ?? 0
    if (valor < minimo || valor > maximo) {
      const rango = minimo === maximo
        ? minimo.toLocaleString('es-CL')
        : `entre ${minimo.toLocaleString('es-CL')} y ${maximo.toLocaleString('es-CL')}`
      console.error(`  ❌ ${clave}: esperado ${rango}, obtenido ${valor.toLocaleString('es-CL')}`)
      fallas++
    }
  }
}

// ── ¿La UF vieja de la planilla cambiaba algún número? ──────────────────────
// A estos sueldos los topes imponibles no muerden (el imponible está muy por
// debajo de las 90 UF) y la renta queda bajo el tramo exento, así que no
// debería. Se comprueba en vez de suponerlo.
console.log('\n═══ Contraste: indicadores de la planilla vs. los reales de julio ═══')
for (const empleado of [oscar, juan]) {
  const conPlanilla = liquidar({ empleado, novedades, parametros }).liquidacion.totales
  const conReales = liquidar({ empleado, novedades, parametros: parametrosReales }).liquidacion.totales
  const delta = conReales.liquido - conPlanilla.liquido
  const nombre = empleado.nombre_completo.split(' ').slice(-2).join(' ')
  console.log(
    `  ${nombre.padEnd(22)} líquido $${conPlanilla.liquido.toLocaleString('es-CL')} → ` +
    `$${conReales.liquido.toLocaleString('es-CL')}  ${delta === 0 ? '(sin diferencia ✅)' : `(⚠️ ${delta > 0 ? '+' : ''}${delta})`}`,
  )
  if (delta !== 0) fallas++
}

console.log('')
if (fallas) {
  console.error(`❌ ${fallas} diferencia(s) contra la planilla de julio.`)
  process.exit(1)
}
console.log('✅ El motor reproduce la planilla de julio 2026, y la UF desactualizada no alteraba el líquido.')
