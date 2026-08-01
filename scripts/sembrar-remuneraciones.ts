/**
 * Siembra inicial del módulo de Remuneraciones: los dos empleados y los
 * parámetros legales de 2026.
 *
 *   npx tsx scripts/sembrar-remuneraciones.ts          (muestra qué haría)
 *   npx tsx scripts/sembrar-remuneraciones.ts --aplicar
 *
 * Requiere haber corrido antes `supabase/remuneraciones.sql` en Supabase.
 * Es idempotente: no duplica un empleado que ya exista con el mismo RUT ni un
 * período de parámetros ya cargado.
 *
 * ⚠️ La UF y la UTM de cada mes las publican el Banco Central y el SII: acá solo
 * van las de junio 2026 (las que traía la planilla). El resto quedan en 0 y hay
 * que completarlas en la pestaña «Parámetros legales» antes de liquidar ese mes.
 */
import './_env-preload'
import { getSheetData } from '../lib/datastore'
import { crearEmpleado, listarEmpleados } from '../lib/remuneraciones/datos'
import { guardarParametros } from '../lib/remuneraciones/parametros'
import { parametrosPorDefecto } from '../lib/remuneraciones/tablas'
import { limpiarRut } from '../lib/rut'
import type { Empleado } from '../lib/remuneraciones/tipos'

const APLICAR = process.argv.includes('--aplicar')

const COMUN = {
  unidad_negocio: 'CASA MATRIZ',
  tipo_contrato: 'plazo_fijo' as const,
  fecha_ingreso: '2025-12-01',
  fecha_termino: '2026-05-31',
  jornada_semanal_horas: 42,
  sueldo_base: 539000,
  modalidad_variable: 'meta_liquido' as const,
  valor_por_cremacion: 1750,
  nacionalidad: 'Chilena',
  activo: true,
  haberes_no_imponibles: [],
}

const EMPLEADOS: Partial<Empleado>[] = [
  {
    ...COMUN,
    nombre_completo: 'MUÑOZ SOTO OSCAR NEFTALÍ',
    rut: '19.381.790-4',
    cargo: 'CHOFER',
    afp: 'modelo',
    prevision_salud: 'fonasa',
  },
  {
    ...COMUN,
    nombre_completo: 'PALENCIA RODRIGUEZ JUAN MIGUEL',
    rut: '28.842.662-7',
    cargo: 'OPERARIO',
    afp: 'uno',
    prevision_salud: 'no_tiene',
    notas: 'Sin previsión de salud: el 7% se descuenta y se le entrega aparte como reembolso.',
  },
]

/** Valores de cierre conocidos. Los que faltan se completan desde la app. */
const VALORES_CONOCIDOS: Record<string, { valor_uf: number; valor_utm: number }> = {
  '2026-06': { valor_uf: 40820.31, valor_utm: 71506 },
}

const PERIODOS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']

async function main() {
  if (!APLICAR) console.log('— Simulación (agrega --aplicar para escribir) —\n')

  // Chequeo temprano: si las tablas no existen, el error de PostgREST es críptico.
  try {
    await getSheetData('rrhh_empleados')
  } catch (e) {
    console.error('❌ No pude leer `rrhh_empleados`. ¿Corriste supabase/remuneraciones.sql en Supabase?')
    console.error('  ', String(e))
    process.exit(1)
  }

  // ── Empleados ─────────────────────────────────────────────────────────────
  const existentes = await listarEmpleados(true)
  const rutsExistentes = new Set(existentes.map(e => limpiarRut(e.rut)).filter(Boolean))

  for (const e of EMPLEADOS) {
    if (rutsExistentes.has(limpiarRut(e.rut))) {
      console.log(`·  ${e.nombre_completo} — ya existe, no lo toco`)
      continue
    }
    console.log(`+  ${e.nombre_completo} (${e.rut}) — AFP ${e.afp}, ${e.prevision_salud}`)
    // Un getNextId fresco por fila: crearEmpleado lo hace por dentro, y el loop
    // es secuencial a propósito.
    if (APLICAR) await crearEmpleado(e)
  }

  // ── Parámetros por período ────────────────────────────────────────────────
  const yaCargados = new Set((await getSheetData('rrhh_parametros').catch(() => [])).map(r => String(r.periodo)))

  console.log('')
  for (const periodo of PERIODOS) {
    if (yaCargados.has(periodo)) {
      console.log(`·  ${periodo} — ya cargado, no lo toco`)
      continue
    }
    const base = parametrosPorDefecto(periodo)
    const conocidos = VALORES_CONOCIDOS[periodo]
    const p = { ...base, ...(conocidos || {}) }
    const marca = conocidos ? '' : '  ⚠️ falta UF/UTM'
    console.log(
      `+  ${periodo} — mínimo ${p.imm.toLocaleString('es-CL')}, topes ${p.tope_afp_uf}/${p.tope_afc_uf} UF, ` +
      `SIS ${p.tasa_sis}%, seguro social ${p.tasa_seguro_social}%${marca}`,
    )
    if (APLICAR) {
      await guardarParametros(periodo, {
        ...p,
        notas: conocidos ? 'Valores de la planilla de junio.' : 'Falta cargar UF y UTM del mes.',
      })
    }
  }

  console.log('')
  if (APLICAR) {
    console.log('✅ Listo. Completa la UF y la UTM de cada mes en Remuneraciones → Parámetros legales.')
  } else {
    console.log('Nada se escribió. Volvé a correr con --aplicar.')
  }
}

main().catch(e => { console.error(e); process.exit(1) })
