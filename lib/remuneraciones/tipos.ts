/**
 * Tipos compartidos del módulo de Remuneraciones.
 *
 * El motor ([motor.ts]) es PURO: recibe empleado + novedades + parámetros y
 * devuelve la liquidación completa. No lee la hora del sistema ni toca la base
 * de datos, así que se puede verificar con un script contra los números reales
 * del contador (scripts/verificar-remuneraciones.ts).
 */

export type TipoContrato = 'indefinido' | 'plazo_fijo'
export type PrevisionSalud = 'fonasa' | 'isapre' | 'no_tiene'
export type ModalidadVariable = 'meta_liquido' | 'monto_directo' | 'ninguna'
export type EstadoLiquidacion = 'borrador' | 'cerrada' | 'pagada'

/** Tramo de la tabla de Impuesto Único de Segunda Categoría (expresado en UTM). */
export interface TramoImpuesto {
  desde_utm: number
  /** null = último tramo, sin techo. */
  hasta_utm: number | null
  /** Tasa marginal (0.04 = 4%). */
  tasa: number
  /** Rebaja en UTM. */
  rebaja_utm: number
}

export interface MontoNombrado {
  nombre: string
  monto: number
}

/**
 * Valores legales vigentes en un período (mes). Se guardan por período porque
 * cambian: los topes imponibles se reajustan cada año y el aporte previsional
 * del empleador (Ley 21.735) sube todos los años hasta 2033.
 */
export interface Parametros {
  periodo: string // 'YYYY-MM'
  valor_uf: number
  valor_utm: number
  imm: number
  tope_afp_uf: number
  tope_afc_uf: number
  /** { modelo: 10.58, uno: 10.46, … } — cotización total (10% + comisión). */
  tasas_afp: Record<string, number>
  tramos_impuesto: TramoImpuesto[]
  tasa_afc_trabajador: number
  tasa_afc_empleador_indefinido: number
  tasa_afc_empleador_plazo_fijo: number
  tasa_mutual: number
  /** Seguro de Invalidez y Sobrevivencia. 0 desde ago-2026 (lo absorbe el seguro social). */
  tasa_sis: number
  tasa_cuenta_individual: number
  tasa_fapp: number
  tasa_seguro_social: number
  /** 0.25 = 25% */
  factor_gratificacion: number
  /** Tope de gratificación en IMM anuales: IMM × 4,75 / 12. */
  tope_gratificacion_imm: number
}

/** Lo que del empleado necesita el cálculo (subconjunto de rrhh_empleados). */
export interface EmpleadoCalculo {
  nombre_completo: string
  rut: string
  cargo: string
  tipo_contrato: TipoContrato
  jornada_semanal_horas: number
  sueldo_base: number
  modalidad_variable: ModalidadVariable
  valor_por_cremacion: number
  afp: string
  prevision_salud: PrevisionSalud
  /** Cotización pactada con la isapre, en UF. */
  plan_salud_uf: number
  apv_monto: number
  haberes_no_imponibles: MontoNombrado[]
}

/** El empleado completo, como vive en `rrhh_empleados`. */
export interface Empleado extends EmpleadoCalculo {
  id: string
  usuario_id: string
  fecha_nacimiento: string
  nacionalidad: string
  direccion: string
  comuna: string
  email: string
  telefono: string
  unidad_negocio: string
  fecha_ingreso: string
  fecha_termino: string
  isapre_codigo: string
  apv_institucion: string
  banco: string
  tipo_cuenta: string
  numero_cuenta: string
  activo: boolean
  notas: string
}

/** Lo que varía mes a mes. */
export interface Novedades {
  /** Cremaciones efectivamente realizadas en el mes. */
  cremaciones: number
  /** Días del mes trabajados sobre 30 (proporcionalidad del sueldo base). */
  dias_trabajados: number
  /** Días efectivamente trabajados: denominador de la semana corrida. */
  dias_efectivos: number
  /** Domingos + festivos: multiplicador de la semana corrida. */
  dias_descanso: number
  horas_extra: number
  otros_imponibles: MontoNombrado[]
  otros_no_imponibles: MontoNombrado[]
  otros_descuentos: MontoNombrado[]
  anticipos: number
}

/** Una línea de la liquidación, con la aritmética visible. */
export interface Linea {
  etiqueta: string
  monto: number
  /** Cómo salió el número, para mostrarlo en la UI y en el PDF. */
  formula?: string
}

export interface Liquidacion {
  haberes: {
    imponibles: Linea[]
    no_imponibles: Linea[]
  }
  descuentos: {
    legales: Linea[]
    otros: Linea[]
  }
  aportes_empleador: Linea[]
  totales: {
    variable_imponible: number
    total_imponible: number
    total_no_imponible: number
    total_haberes: number
    base_tributable: number
    impuesto_unico: number
    total_descuentos: number
    liquido: number
    /** Solo cuando no tiene previsión de salud: el 7% se le entrega aparte. */
    reembolso_salud: number
    total_a_transferir: number
    aportes_empleador: number
    costo_empresa: number
  }
}

/** Resultado del solver que reemplaza al Solver de Excel. */
export interface ResultadoSolver {
  /** Bono variable imponible que hace falta para alcanzar la meta. */
  variable_imponible: number
  liquido: number
  meta: number
  /** True si el líquido dio exactamente la meta. */
  exacto: boolean
  /** liquido − meta (siempre ≥ 0: se toma el menor bono que alcanza la meta). */
  diferencia: number
}
