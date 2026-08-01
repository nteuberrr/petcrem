/**
 * Parámetros legales por período: lectura, escritura y siembra.
 *
 * Cada mes tiene su fila en `rrhh_parametros`. Si falta, la UI avisa y ofrece
 * duplicar el mes anterior — nunca se calcula con valores de otro período por
 * detrás, porque ahí es donde el Excel se equivocaba en silencio.
 */
import { appendRow, getNextId, getSheetData, updateById } from '@/lib/datastore'
import { todayISO } from '@/lib/dates'
import { parseDecimalOr0 } from '@/lib/numbers'
import { obtenerIndicadores } from './indicadores'
import { parametrosPorDefecto, TRAMOS_IUSC, TASAS_AFP } from './tablas'
import type { Parametros, TramoImpuesto } from './tipos'

const HOJA = 'rrhh_parametros'

type Fila = Record<string, string>

function json<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    const v = JSON.parse(raw)
    return v == null ? fallback : (v as T)
  } catch {
    return fallback
  }
}

export function parsearParametros(r: Fila): Parametros {
  const def = parametrosPorDefecto(String(r.periodo || ''))
  const num = (campo: string, alt: number) => (r[campo] === '' || r[campo] == null ? alt : parseDecimalOr0(r[campo]))
  return {
    periodo: String(r.periodo || ''),
    valor_uf: num('valor_uf', 0),
    valor_utm: num('valor_utm', 0),
    imm: num('imm', def.imm),
    tope_afp_uf: num('tope_afp_uf', def.tope_afp_uf),
    tope_afc_uf: num('tope_afc_uf', def.tope_afc_uf),
    tasas_afp: json<Record<string, number>>(r.tasas_afp, { ...TASAS_AFP }),
    tramos_impuesto: json<TramoImpuesto[]>(r.tramos_impuesto, TRAMOS_IUSC),
    tasa_afc_trabajador: num('tasa_afc_trabajador', def.tasa_afc_trabajador),
    tasa_afc_empleador_indefinido: num('tasa_afc_empleador_indefinido', def.tasa_afc_empleador_indefinido),
    tasa_afc_empleador_plazo_fijo: num('tasa_afc_empleador_plazo_fijo', def.tasa_afc_empleador_plazo_fijo),
    tasa_mutual: num('tasa_mutual', def.tasa_mutual),
    tasa_sis: num('tasa_sis', def.tasa_sis),
    tasa_cuenta_individual: num('tasa_cuenta_individual', def.tasa_cuenta_individual),
    tasa_fapp: num('tasa_fapp', def.tasa_fapp),
    tasa_seguro_social: num('tasa_seguro_social', def.tasa_seguro_social),
    factor_gratificacion: num('factor_gratificacion', def.factor_gratificacion),
    tope_gratificacion_imm: num('tope_gratificacion_imm', def.tope_gratificacion_imm),
  }
}

/** Overrides manuales del calendario del mes (vacío = se calcula del almanaque). */
export function overridesCalendario(r: Fila): { dias_habiles: number | null; dias_descanso: number | null } {
  return {
    dias_habiles: r.dias_habiles ? parseDecimalOr0(r.dias_habiles) : null,
    dias_descanso: r.dias_descanso ? parseDecimalOr0(r.dias_descanso) : null,
  }
}

function serializar(p: Parametros): Record<string, unknown> {
  return {
    periodo: p.periodo,
    valor_uf: p.valor_uf,
    valor_utm: p.valor_utm,
    imm: p.imm,
    tope_afp_uf: p.tope_afp_uf,
    tope_afc_uf: p.tope_afc_uf,
    tasas_afp: JSON.stringify(p.tasas_afp),
    tramos_impuesto: JSON.stringify(p.tramos_impuesto),
    tasa_afc_trabajador: p.tasa_afc_trabajador,
    tasa_afc_empleador_indefinido: p.tasa_afc_empleador_indefinido,
    tasa_afc_empleador_plazo_fijo: p.tasa_afc_empleador_plazo_fijo,
    tasa_mutual: p.tasa_mutual,
    tasa_sis: p.tasa_sis,
    tasa_cuenta_individual: p.tasa_cuenta_individual,
    tasa_fapp: p.tasa_fapp,
    tasa_seguro_social: p.tasa_seguro_social,
    factor_gratificacion: p.factor_gratificacion,
    tope_gratificacion_imm: p.tope_gratificacion_imm,
  }
}

export async function listarFilasParametros(): Promise<Fila[]> {
  const rows = await getSheetData(HOJA).catch(() => [] as Fila[])
  return rows.sort((a, b) => String(b.periodo).localeCompare(String(a.periodo)))
}

export async function getFilaParametros(periodo: string): Promise<Fila | null> {
  const rows = await getSheetData(HOJA).catch(() => [] as Fila[])
  return rows.find(r => String(r.periodo) === periodo) || null
}

export async function getParametros(periodo: string): Promise<Parametros | null> {
  const fila = await getFilaParametros(periodo)
  return fila ? parsearParametros(fila) : null
}

/**
 * Crea o actualiza los parámetros de un período. `base` puede venir de otro
 * período (duplicar) o de los valores por defecto.
 */
export async function guardarParametros(
  periodo: string,
  cambios: Partial<Parametros> & { dias_habiles?: number | null; dias_descanso?: number | null; notas?: string },
): Promise<Parametros> {
  const existente = await getFilaParametros(periodo)
  const actual = existente ? parsearParametros(existente) : parametrosPorDefecto(periodo)
  const merged: Parametros = { ...actual, ...cambios, periodo }

  const extra = {
    dias_habiles: cambios.dias_habiles == null ? (existente?.dias_habiles ?? '') : cambios.dias_habiles,
    dias_descanso: cambios.dias_descanso == null ? (existente?.dias_descanso ?? '') : cambios.dias_descanso,
    notas: cambios.notas ?? existente?.notas ?? '',
  }

  if (existente) {
    await updateById(HOJA, existente.id, { ...existente, ...serializar(merged), ...extra })
  } else {
    const id = await getNextId(HOJA)
    await appendRow(HOJA, { id, ...serializar(merged), ...extra, fecha_creacion: todayISO() })
  }
  return merged
}

/** Período anterior a uno dado: '2026-08' → '2026-07'. */
export function periodoAnterior(periodo: string): string {
  const [a, m] = periodo.split('-').map(Number)
  if (!a || !m) return periodo
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`
}

export interface ResultadoAutocompletar {
  periodo: string
  /** 'creado' | 'actualizado' | 'sin_cambios' | 'sin_datos' */
  accion: string
  uf: number
  utm: number
  detalle: string[]
  avisos: string[]
}

/**
 * Deja un período listo sin intervención: si no existe lo crea copiando las
 * tasas del mes anterior (para no perder ajustes hechos a mano), y le pone la UF
 * y la UTM traídas de la fuente.
 *
 * Por defecto NO pisa valores ya cargados — si alguien corrigió la UF a mano, se
 * respeta. `forzar: true` los reemplaza.
 */
export async function autocompletarPeriodo(
  periodo: string,
  opts: { forzar?: boolean } = {},
): Promise<ResultadoAutocompletar> {
  const existente = await getFilaParametros(periodo)
  const actual = existente ? parsearParametros(existente) : null
  const detalle: string[] = []

  // Base: lo que ya hay, o el mes anterior (conserva las tasas ajustadas a mano),
  // o los valores por defecto del período.
  let base = actual
  if (!base) {
    const previo = await getParametros(periodoAnterior(periodo))
    if (previo) {
      // Las tasas del aporte del empleador cambian por tramos legales: se toman
      // las que corresponden al período nuevo, no las heredadas.
      const def = parametrosPorDefecto(periodo)
      base = {
        ...previo,
        periodo,
        imm: def.imm,
        tope_afp_uf: def.tope_afp_uf,
        tope_afc_uf: def.tope_afc_uf,
        tasa_sis: def.tasa_sis,
        tasa_cuenta_individual: def.tasa_cuenta_individual,
        tasa_fapp: def.tasa_fapp,
        tasa_seguro_social: def.tasa_seguro_social,
        valor_uf: 0,
        valor_utm: 0,
      }
      detalle.push(`Tasas copiadas de ${periodoAnterior(periodo)}; topes y aporte del empleador según lo vigente en ${periodo}.`)
    } else {
      base = parametrosPorDefecto(periodo)
      detalle.push('Creado con los valores por defecto del período.')
    }
  }

  const ind = await obtenerIndicadores(periodo)
  const cambios: Partial<Parametros> = {}

  if (ind.uf && (opts.forzar || !base.valor_uf)) {
    cambios.valor_uf = ind.uf.valor
    detalle.push(`UF ${ind.uf.valor.toLocaleString('es-CL')} (del ${ind.uf.fecha}).`)
  } else if (base.valor_uf && ind.uf && Math.round(base.valor_uf) !== Math.round(ind.uf.valor)) {
    detalle.push(`Se conserva la UF cargada (${base.valor_uf.toLocaleString('es-CL')}); la fuente dice ${ind.uf.valor.toLocaleString('es-CL')}.`)
  }

  if (ind.utm && (opts.forzar || !base.valor_utm)) {
    cambios.valor_utm = ind.utm.valor
    detalle.push(`UTM ${ind.utm.valor.toLocaleString('es-CL')} (del ${ind.utm.fecha}).`)
  } else if (base.valor_utm && ind.utm && Math.round(base.valor_utm) !== Math.round(ind.utm.valor)) {
    detalle.push(`Se conserva la UTM cargada (${base.valor_utm.toLocaleString('es-CL')}); la fuente dice ${ind.utm.valor.toLocaleString('es-CL')}.`)
  }

  const hayQueEscribir = !existente || Object.keys(cambios).length > 0
  if (hayQueEscribir) {
    await guardarParametros(periodo, { ...base, ...cambios })
  }

  return {
    periodo,
    accion: !existente ? 'creado' : Object.keys(cambios).length ? 'actualizado' : (ind.uf || ind.utm) ? 'sin_cambios' : 'sin_datos',
    uf: cambios.valor_uf ?? base.valor_uf,
    utm: cambios.valor_utm ?? base.valor_utm,
    detalle,
    avisos: ind.avisos,
  }
}

/** Qué le falta a un período para poder calcular. Vacío = está listo. */
export function faltantes(p: Parametros | null): string[] {
  if (!p) return ['No están cargados los parámetros del período.']
  const out: string[] = []
  if (!p.valor_uf) out.push('Falta el valor de la UF del mes.')
  if (!p.valor_utm) out.push('Falta el valor de la UTM del mes.')
  if (!p.imm) out.push('Falta el ingreso mínimo mensual.')
  return out
}
