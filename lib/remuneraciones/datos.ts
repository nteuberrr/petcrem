/**
 * Acceso a datos del módulo de Remuneraciones. Es el ÚNICO archivo que toca el
 * datastore para las tablas `rrhh_*`; el motor y el solver siguen siendo puros.
 */
import { appendRow, deleteById, getNextId, getSheetData, updateById } from '@/lib/datastore'
import { todayISO } from '@/lib/dates'
import { parseDecimalOr0 } from '@/lib/numbers'
import type {
  Empleado, EstadoLiquidacion, Liquidacion, MontoNombrado, ModalidadVariable,
  Novedades, Parametros, PrevisionSalud, ResultadoSolver, TipoContrato,
} from './tipos'

type Fila = Record<string, string>

const T_EMPLEADOS = 'rrhh_empleados'
const T_LIQUIDACIONES = 'rrhh_liquidaciones'
const T_PAGOS = 'rrhh_pagos'

function json<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    const v = JSON.parse(raw)
    return v == null ? fallback : (v as T)
  } catch {
    return fallback
  }
}

// ── Empleados ───────────────────────────────────────────────────────────────

export function parsearEmpleado(r: Fila): Empleado {
  return {
    id: String(r.id || ''),
    usuario_id: String(r.usuario_id || ''),
    nombre_completo: String(r.nombre_completo || ''),
    rut: String(r.rut || ''),
    fecha_nacimiento: String(r.fecha_nacimiento || ''),
    nacionalidad: String(r.nacionalidad || ''),
    direccion: String(r.direccion || ''),
    comuna: String(r.comuna || ''),
    email: String(r.email || ''),
    telefono: String(r.telefono || ''),
    cargo: String(r.cargo || ''),
    unidad_negocio: String(r.unidad_negocio || 'CASA MATRIZ'),
    tipo_contrato: (String(r.tipo_contrato || 'plazo_fijo') as TipoContrato),
    fecha_ingreso: String(r.fecha_ingreso || ''),
    fecha_termino: String(r.fecha_termino || ''),
    jornada_semanal_horas: parseDecimalOr0(r.jornada_semanal_horas) || 42,
    sueldo_base: parseDecimalOr0(r.sueldo_base),
    modalidad_variable: (String(r.modalidad_variable || 'ninguna') as ModalidadVariable),
    valor_por_cremacion: parseDecimalOr0(r.valor_por_cremacion),
    haberes_no_imponibles: json<MontoNombrado[]>(r.haberes_no_imponibles, []),
    afp: String(r.afp || ''),
    prevision_salud: (String(r.prevision_salud || 'fonasa') as PrevisionSalud),
    isapre_codigo: String(r.isapre_codigo || ''),
    plan_salud_uf: parseDecimalOr0(r.plan_salud_uf),
    apv_monto: parseDecimalOr0(r.apv_monto),
    apv_institucion: String(r.apv_institucion || ''),
    banco: String(r.banco || ''),
    tipo_cuenta: String(r.tipo_cuenta || ''),
    numero_cuenta: String(r.numero_cuenta || ''),
    activo: String(r.activo || 'TRUE') !== 'FALSE',
    notas: String(r.notas || ''),
  }
}

function serializarEmpleado(e: Partial<Empleado>): Record<string, unknown> {
  return {
    usuario_id: e.usuario_id ?? '',
    nombre_completo: e.nombre_completo ?? '',
    rut: e.rut ?? '',
    fecha_nacimiento: e.fecha_nacimiento ?? '',
    nacionalidad: e.nacionalidad ?? '',
    direccion: e.direccion ?? '',
    comuna: e.comuna ?? '',
    email: e.email ?? '',
    telefono: e.telefono ?? '',
    cargo: e.cargo ?? '',
    unidad_negocio: e.unidad_negocio ?? '',
    tipo_contrato: e.tipo_contrato ?? 'plazo_fijo',
    fecha_ingreso: e.fecha_ingreso ?? '',
    fecha_termino: e.fecha_termino ?? '',
    jornada_semanal_horas: e.jornada_semanal_horas ?? 42,
    sueldo_base: e.sueldo_base ?? 0,
    modalidad_variable: e.modalidad_variable ?? 'ninguna',
    valor_por_cremacion: e.valor_por_cremacion ?? 0,
    haberes_no_imponibles: JSON.stringify(e.haberes_no_imponibles ?? []),
    afp: e.afp ?? '',
    prevision_salud: e.prevision_salud ?? 'fonasa',
    isapre_codigo: e.isapre_codigo ?? '',
    plan_salud_uf: e.plan_salud_uf ?? 0,
    apv_monto: e.apv_monto ?? 0,
    apv_institucion: e.apv_institucion ?? '',
    banco: e.banco ?? '',
    tipo_cuenta: e.tipo_cuenta ?? '',
    numero_cuenta: e.numero_cuenta ?? '',
    activo: e.activo === false ? 'FALSE' : 'TRUE',
    notas: e.notas ?? '',
  }
}

export async function listarEmpleados(incluirInactivos = true): Promise<Empleado[]> {
  const rows = await getSheetData(T_EMPLEADOS).catch(() => [] as Fila[])
  const out = rows.map(parsearEmpleado)
  return (incluirInactivos ? out : out.filter(e => e.activo))
    .sort((a, b) => a.nombre_completo.localeCompare(b.nombre_completo))
}

export async function getEmpleado(id: string): Promise<Empleado | null> {
  const rows = await getSheetData(T_EMPLEADOS).catch(() => [] as Fila[])
  const fila = rows.find(r => String(r.id) === String(id))
  return fila ? parsearEmpleado(fila) : null
}

export async function crearEmpleado(datos: Partial<Empleado>): Promise<Empleado> {
  const id = await getNextId(T_EMPLEADOS)
  const row = { id, ...serializarEmpleado(datos), fecha_creacion: todayISO() }
  await appendRow(T_EMPLEADOS, row)
  return parsearEmpleado(row as unknown as Fila)
}

export async function actualizarEmpleado(id: string, datos: Partial<Empleado>): Promise<Empleado | null> {
  const rows = await getSheetData(T_EMPLEADOS).catch(() => [] as Fila[])
  const fila = rows.find(r => String(r.id) === String(id))
  if (!fila) return null
  const actual = parsearEmpleado(fila)
  const merged = { ...actual, ...datos }
  // updateById reescribe la fila COMPLETA: hay que pasarle todo.
  await updateById(T_EMPLEADOS, id, { ...fila, ...serializarEmpleado(merged) })
  return merged
}

// ── Liquidaciones ───────────────────────────────────────────────────────────

export interface LiquidacionGuardada {
  id: string
  periodo: string
  empleado_id: string
  empleado_nombre: string
  estado: EstadoLiquidacion
  cremaciones: number
  meta_liquido: number
  liquido: number
  reembolso_salud: number
  total_a_transferir: number
  total_haberes: number
  total_descuentos: number
  aportes_empleador: number
  costo_empresa: number
  exacto: boolean
  diferencia_meta: number
  detalle: Liquidacion | null
  parametros: Parametros | null
  novedades: Novedades | null
  pdf_url: string
  fecha_pago: string
}

export function parsearLiquidacion(r: Fila): LiquidacionGuardada {
  return {
    id: String(r.id || ''),
    periodo: String(r.periodo || ''),
    empleado_id: String(r.empleado_id || ''),
    empleado_nombre: String(r.empleado_nombre || ''),
    estado: (String(r.estado || 'borrador') as EstadoLiquidacion),
    cremaciones: parseDecimalOr0(r.cremaciones),
    meta_liquido: parseDecimalOr0(r.meta_liquido),
    liquido: parseDecimalOr0(r.liquido),
    reembolso_salud: parseDecimalOr0(r.reembolso_salud),
    total_a_transferir: parseDecimalOr0(r.total_a_transferir),
    total_haberes: parseDecimalOr0(r.total_haberes),
    total_descuentos: parseDecimalOr0(r.total_descuentos),
    aportes_empleador: parseDecimalOr0(r.aportes_empleador),
    costo_empresa: parseDecimalOr0(r.costo_empresa),
    exacto: String(r.exacto || 'TRUE') !== 'FALSE',
    diferencia_meta: parseDecimalOr0(r.diferencia_meta),
    detalle: json<Liquidacion | null>(r.detalle_json, null),
    parametros: json<Parametros | null>(r.parametros_json, null),
    novedades: json<Novedades | null>(r.novedades_json, null),
    pdf_url: String(r.pdf_url || ''),
    fecha_pago: String(r.fecha_pago || ''),
  }
}

export interface GuardarLiquidacionInput {
  periodo: string
  empleado: Empleado
  liquidacion: Liquidacion
  solver: ResultadoSolver | null
  novedades: Novedades
  parametros: Parametros
  estado: EstadoLiquidacion
  cerradaPor?: string
}

function serializarLiquidacion(i: GuardarLiquidacionInput): Record<string, unknown> {
  const t = i.liquidacion.totales
  return {
    periodo: i.periodo,
    empleado_id: i.empleado.id,
    empleado_nombre: i.empleado.nombre_completo,
    estado: i.estado,
    cremaciones: i.novedades.cremaciones,
    meta_liquido: i.solver?.meta ?? 0,
    variable_imponible: t.variable_imponible,
    total_imponible: t.total_imponible,
    total_no_imponible: t.total_no_imponible,
    total_haberes: t.total_haberes,
    total_descuentos: t.total_descuentos,
    impuesto_unico: t.impuesto_unico,
    liquido: t.liquido,
    reembolso_salud: t.reembolso_salud,
    total_a_transferir: t.total_a_transferir,
    aportes_empleador: t.aportes_empleador,
    costo_empresa: t.costo_empresa,
    exacto: i.solver ? (i.solver.exacto ? 'TRUE' : 'FALSE') : 'TRUE',
    diferencia_meta: i.solver?.diferencia ?? 0,
    detalle_json: JSON.stringify(i.liquidacion),
    parametros_json: JSON.stringify(i.parametros),
    novedades_json: JSON.stringify(i.novedades),
  }
}

export async function listarLiquidaciones(periodo?: string): Promise<LiquidacionGuardada[]> {
  const rows = await getSheetData(T_LIQUIDACIONES).catch(() => [] as Fila[])
  return rows
    .filter(r => !periodo || String(r.periodo) === periodo)
    .map(parsearLiquidacion)
    .sort((a, b) => b.periodo.localeCompare(a.periodo) || a.empleado_nombre.localeCompare(b.empleado_nombre))
}

export async function getLiquidacion(id: string): Promise<LiquidacionGuardada | null> {
  const rows = await getSheetData(T_LIQUIDACIONES).catch(() => [] as Fila[])
  const fila = rows.find(r => String(r.id) === String(id))
  return fila ? parsearLiquidacion(fila) : null
}

/**
 * Guarda (o pisa) la liquidación de un empleado en un período. Idempotente por
 * (periodo, empleado_id), que además es una constraint única en la base.
 */
export async function guardarLiquidacion(i: GuardarLiquidacionInput): Promise<void> {
  const rows = await getSheetData(T_LIQUIDACIONES).catch(() => [] as Fila[])
  const fila = rows.find(r => String(r.periodo) === i.periodo && String(r.empleado_id) === String(i.empleado.id))
  const datos = serializarLiquidacion(i)
  if (fila) {
    await updateById(T_LIQUIDACIONES, fila.id, {
      ...fila,
      ...datos,
      cerrada_por: i.cerradaPor ?? fila.cerrada_por ?? '',
    })
  } else {
    const id = await getNextId(T_LIQUIDACIONES)
    await appendRow(T_LIQUIDACIONES, {
      id, ...datos, cerrada_por: i.cerradaPor ?? '', fecha_creacion: todayISO(),
    })
  }
}

/** Cambia el estado de todas las liquidaciones de un período. */
export async function cambiarEstadoPeriodo(
  periodo: string,
  estado: EstadoLiquidacion,
  extra: { fecha_pago?: string; cerrada_por?: string } = {},
): Promise<number> {
  const rows = await getSheetData(T_LIQUIDACIONES).catch(() => [] as Fila[])
  const delPeriodo = rows.filter(r => String(r.periodo) === periodo)
  for (const fila of delPeriodo) {
    await updateById(T_LIQUIDACIONES, fila.id, {
      ...fila,
      estado,
      fecha_pago: extra.fecha_pago ?? (estado === 'pagada' ? fila.fecha_pago : ''),
      cerrada_por: extra.cerrada_por ?? fila.cerrada_por ?? '',
    })
  }
  return delPeriodo.length
}

export async function borrarLiquidacion(id: string): Promise<void> {
  await deleteById(T_LIQUIDACIONES, id)
}

export async function guardarPdfLiquidacion(id: string, key: string, url: string): Promise<void> {
  const rows = await getSheetData(T_LIQUIDACIONES).catch(() => [] as Fila[])
  const fila = rows.find(r => String(r.id) === String(id))
  if (!fila) return
  await updateById(T_LIQUIDACIONES, id, { ...fila, pdf_key: key, pdf_url: url })
}

// ── Orden de pago ───────────────────────────────────────────────────────────

export interface PagoPeriodo {
  id: string
  periodo: string
  liquidacion_ids: string[]
  total_liquidos: number
  total_reembolsos: number
  total_transferido: number
  costo_empresa: number
  fecha_pago: string
  comentarios: string
}

export function parsearPago(r: Fila): PagoPeriodo {
  return {
    id: String(r.id || ''),
    periodo: String(r.periodo || ''),
    liquidacion_ids: json<string[]>(r.liquidacion_ids, []),
    total_liquidos: parseDecimalOr0(r.total_liquidos),
    total_reembolsos: parseDecimalOr0(r.total_reembolsos),
    total_transferido: parseDecimalOr0(r.total_transferido),
    costo_empresa: parseDecimalOr0(r.costo_empresa),
    fecha_pago: String(r.fecha_pago || ''),
    comentarios: String(r.comentarios || ''),
  }
}

export async function getPago(periodo: string): Promise<PagoPeriodo | null> {
  const rows = await getSheetData(T_PAGOS).catch(() => [] as Fila[])
  const fila = rows.find(r => String(r.periodo) === periodo)
  return fila ? parsearPago(fila) : null
}

export async function guardarPago(p: Omit<PagoPeriodo, 'id'> & { creado_por?: string }): Promise<PagoPeriodo> {
  const rows = await getSheetData(T_PAGOS).catch(() => [] as Fila[])
  const fila = rows.find(r => String(r.periodo) === p.periodo)
  const datos = {
    periodo: p.periodo,
    liquidacion_ids: JSON.stringify(p.liquidacion_ids),
    total_liquidos: p.total_liquidos,
    total_reembolsos: p.total_reembolsos,
    total_transferido: p.total_transferido,
    costo_empresa: p.costo_empresa,
    fecha_pago: p.fecha_pago,
    comentarios: p.comentarios,
    creado_por: p.creado_por ?? '',
  }
  if (fila) {
    await updateById(T_PAGOS, fila.id, { ...fila, ...datos })
    return { ...p, id: fila.id }
  }
  const id = await getNextId(T_PAGOS)
  await appendRow(T_PAGOS, { id, ...datos, fecha_creacion: todayISO() })
  return { ...p, id: String(id) }
}

export async function borrarPago(periodo: string): Promise<void> {
  const rows = await getSheetData(T_PAGOS).catch(() => [] as Fila[])
  const fila = rows.find(r => String(r.periodo) === periodo)
  if (fila) await deleteById(T_PAGOS, fila.id)
}
