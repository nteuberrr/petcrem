/**
 * Los montos que hay que declarar y pagar en Previred cada mes.
 *
 * Deliberadamente NO se genera el archivo plano de Previred: son 105 campos en
 * 861 posiciones exactas, con tablas de códigos propias, que se rechaza entero
 * ante un solo carácter fuera de lugar y cuya especificación cambia un par de
 * veces al año (en agosto de 2026 cambia por la reforma previsional). Con dos
 * trabajadores, la declaración directa en el portal toma unos minutos; lo que
 * de verdad hace falta es tener los números correctos y ordenados a mano.
 *
 * Eso es lo que arma este módulo: una fila por trabajador con exactamente lo
 * que pide el formulario de Previred, en el mismo orden.
 */
import type { LiquidacionGuardada } from './datos'
import type { Empleado } from './tipos'
import { NOMBRES_AFP } from './tablas'

export interface FilaCotizacion {
  empleado_id: string
  nombre: string
  rut: string
  /** Renta imponible del mes (ya topada). */
  renta_imponible: number
  afp: string
  /** Cotización obligatoria del trabajador (incluye la comisión de la AFP). */
  cotizacion_afp: number
  /** Cargo del empleador. 0 desde ago-2026: lo absorbe el seguro social. */
  sis: number
  salud_sistema: string
  cotizacion_salud: number
  afc_trabajador: number
  afc_empleador: number
  mutual: number
  /** Ley 21.735, cargo del empleador. */
  seguro_social: number
  cuenta_individual: number
  fapp: number
  /** Suma de todo lo que se paga en Previred por este trabajador. */
  total: number
  /** Avisos que hay que mirar antes de declarar. */
  avisos: string[]
}

function montoDe(lineas: { etiqueta: string; monto: number }[] | undefined, re: RegExp): number {
  return (lineas || []).filter(l => re.test(l.etiqueta)).reduce((s, l) => s + l.monto, 0)
}

export function filasCotizacion(
  liquidaciones: LiquidacionGuardada[],
  empleados: Empleado[],
): FilaCotizacion[] {
  const porId = new Map(empleados.map(e => [e.id, e]))

  return liquidaciones.map(l => {
    const e = porId.get(l.empleado_id)
    const d = l.detalle
    const legales = d?.descuentos.legales
    const aportes = d?.aportes_empleador

    const avisos: string[] = []
    if (!e?.rut) avisos.push('Falta el RUT del trabajador.')
    if (!e?.afp) avisos.push('No tiene AFP asignada.')
    if (e?.prevision_salud === 'no_tiene') {
      avisos.push('Sin previsión de salud: el 7% no se declara en Previred, se le entrega directo.')
    }

    const cotizacionSalud = e?.prevision_salud === 'no_tiene' ? 0 : montoDe(legales, /FONASA|ISAPRE|SALUD/)

    const fila: FilaCotizacion = {
      empleado_id: l.empleado_id,
      nombre: l.empleado_nombre,
      rut: e?.rut || '',
      renta_imponible: d?.totales.total_imponible ?? 0,
      afp: NOMBRES_AFP[e?.afp || ''] || e?.afp || '',
      cotizacion_afp: montoDe(legales, /^AFP /),
      sis: montoDe(aportes, /^SIS/),
      salud_sistema: e?.prevision_salud === 'fonasa' ? 'Fonasa'
        : e?.prevision_salud === 'isapre' ? (e.isapre_codigo || 'Isapre')
        : 'Sin previsión',
      cotizacion_salud: cotizacionSalud,
      afc_trabajador: montoDe(legales, /CESANTÍA/),
      afc_empleador: montoDe(aportes, /^Seguro de cesantía/),
      mutual: montoDe(aportes, /^Mutual/),
      seguro_social: montoDe(aportes, /^Seguro social/),
      cuenta_individual: montoDe(aportes, /^Cuenta individual/),
      fapp: montoDe(aportes, /^FAPP/),
      total: 0,
      avisos,
    }

    fila.total =
      fila.cotizacion_afp + fila.sis + fila.cotizacion_salud +
      fila.afc_trabajador + fila.afc_empleador + fila.mutual +
      fila.seguro_social + fila.cuenta_individual + fila.fapp

    return fila
  })
}
