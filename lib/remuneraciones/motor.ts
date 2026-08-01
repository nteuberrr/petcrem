/**
 * Motor de cálculo de liquidaciones (Chile). PURO: sin I/O, sin fechas del
 * sistema. Entra { empleado, novedades, parámetros, variable imponible } y sale
 * la liquidación completa con cada línea acompañada de su fórmula, para que la
 * UI y el PDF puedan mostrar de dónde salió cada peso.
 *
 * Verificado contra la planilla real de junio 2026 (ver
 * scripts/verificar-remuneraciones.ts): reproduce el líquido al peso.
 */

import type {
  EmpleadoCalculo, Liquidacion, Linea, MontoNombrado, Novedades, Parametros,
} from './tipos'

const clp = (n: number) => '$' + Math.round(n).toLocaleString('es-CL')
const pct = (n: number) => String(n).replace('.', ',') + '%'

function suma(lineas: Linea[]): number {
  return lineas.reduce((s, l) => s + l.monto, 0)
}

function extras(items: MontoNombrado[] | undefined): Linea[] {
  return (items || [])
    .filter(i => Number(i.monto) > 0)
    .map(i => ({ etiqueta: i.nombre, monto: Math.round(Number(i.monto)) }))
}

/** Tope mensual de gratificación legal: IMM × 4,75 / 12. */
export function topeGratificacion(p: Parametros): number {
  return Math.round((p.imm * p.tope_gratificacion_imm) / 12)
}

/** Tope imponible para AFP y salud, en pesos. */
export function topeImponible(p: Parametros): number {
  return Math.round(p.tope_afp_uf * p.valor_uf)
}

/** Tope imponible del seguro de cesantía, en pesos. */
export function topeImponibleAfc(p: Parametros): number {
  return Math.round(p.tope_afc_uf * p.valor_uf)
}

/** Impuesto Único de Segunda Categoría sobre la base tributable, en pesos. */
export function impuestoUnico(baseTributable: number, p: Parametros): { monto: number; formula: string } {
  if (baseTributable <= 0 || !p.valor_utm) return { monto: 0, formula: 'sin base tributable' }
  const utm = baseTributable / p.valor_utm
  const tramo = p.tramos_impuesto.find(t => utm > t.desde_utm && (t.hasta_utm === null || utm <= t.hasta_utm))
    ?? p.tramos_impuesto[0]
  if (!tramo.tasa) {
    return { monto: 0, formula: `${utm.toFixed(2)} UTM — tramo exento (hasta ${tramo.hasta_utm} UTM)` }
  }
  const monto = Math.max(0, Math.round(baseTributable * tramo.tasa) - Math.round(tramo.rebaja_utm * p.valor_utm))
  return {
    monto,
    formula: `${clp(baseTributable)} × ${pct(tramo.tasa * 100)} − ${tramo.rebaja_utm} UTM`,
  }
}

/** Valor de una hora extra (recargo 50%) según la jornada semanal pactada. */
export function valorHoraExtra(sueldoBase: number, jornadaSemanal: number): number {
  if (!jornadaSemanal) return 0
  return Math.round((sueldoBase * 7 * 1.5) / (30 * jornadaSemanal))
}

export interface EntradaCalculo {
  empleado: EmpleadoCalculo
  novedades: Novedades
  parametros: Parametros
  /** Bono variable imponible ya resuelto (lo fija el solver o el monto directo). */
  variableImponible: number
}

/**
 * Calcula la liquidación completa. `variableImponible` viene dado: quién lo
 * decide es [solver.ts] (modalidad meta_liquido) o el monto directo.
 */
export function calcularLiquidacion({ empleado: e, novedades: n, parametros: p, variableImponible }: EntradaCalculo): Liquidacion {
  const B = Math.round(variableImponible)
  const diasTrabajados = n.dias_trabajados > 0 ? n.dias_trabajados : 30
  const diasEfectivos = n.dias_efectivos > 0 ? n.dias_efectivos : 1

  // ── Haberes imponibles ────────────────────────────────────────────────────
  const imponibles: Linea[] = []

  const sueldoBase = Math.round((e.sueldo_base * diasTrabajados) / 30)
  imponibles.push({
    etiqueta: `SUELDO BASE ${diasTrabajados} DÍAS`,
    monto: sueldoBase,
    formula: diasTrabajados === 30 ? 'sueldo base del contrato' : `${clp(e.sueldo_base)} × ${diasTrabajados}/30`,
  })

  if (B > 0) {
    imponibles.push({
      etiqueta: 'Variable por cremación',
      monto: B,
      formula: e.modalidad_variable === 'meta_liquido'
        ? `resuelto para que el líquido dé ${clp(e.sueldo_base + e.valor_por_cremacion * n.cremaciones)} (${n.cremaciones} cremaciones)`
        : `${clp(e.valor_por_cremacion)} × ${n.cremaciones} cremaciones`,
    })
  }

  // Semana corrida (art. 45): promedio diario de lo variable × días de descanso.
  const semanaCorrida = B > 0 && n.dias_descanso > 0
    ? Math.round(B / diasEfectivos) * n.dias_descanso
    : 0
  if (semanaCorrida > 0) {
    imponibles.push({
      etiqueta: 'Semana corrida',
      monto: semanaCorrida,
      formula: `${clp(B)} ÷ ${diasEfectivos} días trabajados × ${n.dias_descanso} días de descanso`,
    })
  }

  const valorHE = valorHoraExtra(e.sueldo_base, e.jornada_semanal_horas)
  const horasExtra = n.horas_extra > 0 ? Math.round(valorHE * n.horas_extra) : 0
  if (horasExtra > 0) {
    imponibles.push({
      etiqueta: `HORAS EXTRA (${n.horas_extra})`,
      monto: horasExtra,
      formula: `${clp(valorHE)} por hora (jornada de ${e.jornada_semanal_horas} h, recargo 50%)`,
    })
  }

  const otrosImp = extras(n.otros_imponibles)
  imponibles.push(...otrosImp)

  // Gratificación legal (art. 50): 25% de lo devengado, con tope.
  const baseGratificacion = sueldoBase + B + semanaCorrida + horasExtra + suma(otrosImp)
  const tope = topeGratificacion(p)
  const gratificacionPlena = Math.round(baseGratificacion * p.factor_gratificacion)
  const gratificacion = Math.min(gratificacionPlena, tope)
  imponibles.push({
    etiqueta: 'GRATIFICACIÓN LEGAL',
    monto: gratificacion,
    formula: gratificacion === tope
      ? `${pct(p.factor_gratificacion * 100)} × ${clp(baseGratificacion)} = ${clp(gratificacionPlena)}, topado en ${clp(tope)}`
      : `${pct(p.factor_gratificacion * 100)} × ${clp(baseGratificacion)} (tope ${clp(tope)})`,
  })

  const totalImponible = suma(imponibles)

  // ── Haberes no imponibles ─────────────────────────────────────────────────
  const noImponibles = [...extras(e.haberes_no_imponibles), ...extras(n.otros_no_imponibles)]
  const totalNoImponible = suma(noImponibles)
  const totalHaberes = totalImponible + totalNoImponible

  // ── Descuentos legales ────────────────────────────────────────────────────
  const topeImp = topeImponible(p)
  const baseAfp = topeImp > 0 ? Math.min(totalImponible, topeImp) : totalImponible
  const legales: Linea[] = []

  const tasaAfp = p.tasas_afp[e.afp] ?? 0
  const afp = Math.round((baseAfp * tasaAfp) / 100)
  legales.push({
    etiqueta: `AFP ${(e.afp || '—').toUpperCase()} ${pct(tasaAfp)}`,
    monto: afp,
    formula: baseAfp < totalImponible
      ? `${pct(tasaAfp)} × ${clp(baseAfp)} (tope ${p.tope_afp_uf} UF)`
      : `${pct(tasaAfp)} × ${clp(baseAfp)}`,
  })

  // Cotización legal de salud: 7% del imponible topado. Si el plan de isapre
  // cuesta más, se descuenta el plan (la diferencia es cotización adicional).
  const saludLegal = Math.round(baseAfp * 0.07)
  let salud = 0
  let saludFormula = ''
  let etiquetaSalud = ''
  if (e.prevision_salud === 'isapre') {
    const plan = Math.round(e.plan_salud_uf * p.valor_uf)
    salud = Math.max(saludLegal, plan)
    etiquetaSalud = 'ISAPRE'
    saludFormula = plan > saludLegal
      ? `plan de ${e.plan_salud_uf} UF = ${clp(plan)} (7% legal: ${clp(saludLegal)})`
      : `7% × ${clp(baseAfp)}`
  } else if (e.prevision_salud === 'fonasa') {
    salud = saludLegal
    etiquetaSalud = 'FONASA 7 %'
    saludFormula = `7% × ${clp(baseAfp)}`
  } else {
    // Sin previsión de salud: se descuenta igual el 7% y se le entrega aparte
    // como reembolso (queda fuera de la liquidación, en la orden de pago).
    salud = saludLegal
    etiquetaSalud = 'SALUD 7 % (sin previsión)'
    saludFormula = `7% × ${clp(baseAfp)} — se reembolsa aparte`
  }
  legales.push({ etiqueta: etiquetaSalud, monto: salud, formula: saludFormula })

  const topeAfc = topeImponibleAfc(p)
  const baseAfc = topeAfc > 0 ? Math.min(totalImponible, topeAfc) : totalImponible
  const afc = e.tipo_contrato === 'indefinido'
    ? Math.round((baseAfc * p.tasa_afc_trabajador) / 100)
    : 0
  legales.push({
    etiqueta: `SEGURO CESANTÍA ${pct(e.tipo_contrato === 'indefinido' ? p.tasa_afc_trabajador : 0)}`,
    monto: afc,
    formula: e.tipo_contrato === 'indefinido'
      ? `${pct(p.tasa_afc_trabajador)} × ${clp(baseAfc)}`
      : 'contrato a plazo fijo: lo paga íntegro el empleador',
  })

  const apv = Math.round(e.apv_monto || 0)
  if (apv > 0) legales.push({ etiqueta: 'APV', monto: apv })

  // Base tributable: solo el 7% legal es rebajable, aunque el plan cueste más.
  const saludRebajable = Math.min(salud, Math.round(topeImp * 0.07) || salud)
  const baseTributable = Math.max(0, totalImponible - afp - afc - apv - saludRebajable)
  const imp = impuestoUnico(baseTributable, p)
  legales.push({ etiqueta: 'IMPUESTO ÚNICO', monto: imp.monto, formula: imp.formula })

  // ── Otros descuentos ──────────────────────────────────────────────────────
  const otros = extras(n.otros_descuentos)
  if (n.anticipos > 0) otros.push({ etiqueta: 'ANTICIPO', monto: Math.round(n.anticipos) })

  const totalDescuentos = suma(legales) + suma(otros)
  const liquido = totalHaberes - totalDescuentos

  // Reembolso de salud: solo para quien no tiene previsión. Se paga fuera de la
  // liquidación, así que NO altera el líquido.
  const reembolsoSalud = e.prevision_salud === 'no_tiene' ? salud : 0

  // ── Aportes del empleador (costo empresa) ─────────────────────────────────
  const aportes: Linea[] = []
  const tasaAfcEmp = e.tipo_contrato === 'indefinido'
    ? p.tasa_afc_empleador_indefinido
    : p.tasa_afc_empleador_plazo_fijo
  const agrega = (etiqueta: string, base: number, tasa: number) => {
    if (!tasa) return
    aportes.push({
      etiqueta,
      monto: Math.round((base * tasa) / 100),
      formula: `${pct(tasa)} × ${clp(base)}`,
    })
  }
  agrega('Seguro de cesantía', baseAfc, tasaAfcEmp)
  agrega('Mutual / ISL', baseAfp, p.tasa_mutual)
  agrega('SIS (invalidez y sobrevivencia)', baseAfp, p.tasa_sis)
  agrega('Seguro social (Ley 21.735)', baseAfp, p.tasa_seguro_social)
  agrega('Cuenta individual (Ley 21.735)', baseAfp, p.tasa_cuenta_individual)
  agrega('FAPP / expectativa de vida', baseAfp, p.tasa_fapp)

  const totalAportes = suma(aportes)

  return {
    haberes: { imponibles, no_imponibles: noImponibles },
    descuentos: { legales, otros },
    aportes_empleador: aportes,
    totales: {
      variable_imponible: B,
      total_imponible: totalImponible,
      total_no_imponible: totalNoImponible,
      total_haberes: totalHaberes,
      base_tributable: baseTributable,
      impuesto_unico: imp.monto,
      total_descuentos: totalDescuentos,
      liquido,
      reembolso_salud: reembolsoSalud,
      total_a_transferir: liquido + reembolsoSalud,
      aportes_empleador: totalAportes,
      // El reembolso también es plata que sale de la empresa.
      costo_empresa: totalHaberes + totalAportes + reembolsoSalud,
    },
  }
}
