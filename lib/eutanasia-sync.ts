import { getSheetData, updateByIdIf } from './datastore'
import { formatDateForSheet, formatHora } from './dates'
import { horaRetiroDeEutanasia } from './agenda'

/**
 * Sincronía entre la COTIZACIÓN de eutanasia y la FICHA de cremación que nace de
 * ella (`cotizaciones_eutanasia.cliente_id` → `clientes`).
 *
 * Son dos filas que describen el mismo día: la cotización manda en la AGENDA
 * (lib/agenda lee las eutanasias desde ahí) y la ficha manda en todo lo demás
 * (lo que ve el chofer, el cobro, el despacho). Hasta ahora nada las mantenía
 * alineadas y se separaban solas: el 30-07 la ficha de Mila decía "hoy 12:30" y
 * la cotización "mañana 12:00", así que el calendario mostraba el servicio el día
 * equivocado.
 *
 * Reglas:
 *  - La FECHA es siempre la misma en las dos.
 *  - La hora del PROCEDIMIENTO (`hora_servicio`) es del veterinario.
 *  - La hora del RETIRO (`hora_retiro_crematorio` en la cotización =
 *    `hora_retiro` en la ficha) es nuestra: son el mismo dato y viajan juntas.
 *
 * Todo best-effort: si falla, se loguea y el caller sigue (nunca bloquea el
 * cambio que el equipo pidió).
 */

/** Cambios aplicados a la cotización que hay que reflejar en su ficha. */
export async function sincronizarFichaDeEutanasia(cot: Record<string, string>): Promise<void> {
  const clienteId = String(cot.cliente_id || '').trim()
  if (!clienteId) return
  const fecha = formatDateForSheet(cot.fecha_servicio)
  // Mientras el vet no informe la hora, la ficha se queda con la del servicio:
  // es la referencia que tiene el equipo para ordenar el día.
  const hora = formatHora(cot.hora_retiro_crematorio) || formatHora(cot.hora_servicio) || ''
  const cambios: Record<string, string> = {}
  if (fecha) cambios.fecha_retiro = fecha
  if (hora) cambios.hora_retiro = hora
  if (Object.keys(cambios).length === 0) return
  try {
    await updateByIdIf('clientes', clienteId, {}, cambios)
  } catch (e) {
    console.warn('[eutanasia-sync] no se pudo actualizar la ficha desde la cotización:', e)
  }
}

/**
 * Al revés: el equipo movió la fecha/hora en la FICHA. Si esa ficha nació de una
 * eutanasia, la cotización tiene que seguirla — si no, la agenda sigue mostrando
 * el día viejo. La hora que se propaga es la del RETIRO; `hora_servicio` (la que
 * el vet acordó con la familia) no se toca.
 *
 * Devuelve el id de la cotización actualizada, o '' si esa ficha no es de una
 * eutanasia.
 */
export async function sincronizarEutanasiaDeFicha(
  clienteId: string,
  cambios: { fecha_retiro?: string; hora_retiro?: string },
): Promise<string> {
  const id = String(clienteId || '').trim()
  if (!id) return ''
  const fecha = cambios.fecha_retiro ? formatDateForSheet(cambios.fecha_retiro) : ''
  const hora = cambios.hora_retiro ? formatHora(cambios.hora_retiro) : ''
  if (!fecha && !hora) return ''
  try {
    const cotis = await getSheetData('cotizaciones_eutanasia')
    const cot = cotis.find(c => String(c.cliente_id || '').trim() === id)
    if (!cot) return ''
    // Una cotización cerrada (realizada / no realizada / cancelada) ya no se mueve.
    if (['realizada', 'no_realizada', 'cancelada'].includes((cot.estado || '').toLowerCase())) return ''
    const patch: Record<string, string> = {}
    if (fecha && formatDateForSheet(cot.fecha_servicio) !== fecha) patch.fecha_servicio = fecha
    if (hora && formatHora(cot.hora_retiro_crematorio) !== hora) patch.hora_retiro_crematorio = hora
    if (Object.keys(patch).length === 0) return ''
    await updateByIdIf('cotizaciones_eutanasia', cot.id, {}, patch)
    return String(cot.id)
  } catch (e) {
    console.warn('[eutanasia-sync] no se pudo actualizar la cotización desde la ficha:', e)
    return ''
  }
}

/**
 * Hora de retiro que corresponde a una hora de procedimiento (procedimiento + 30
 * min). Reexportada acá para que los callers de la sincronía no tengan que
 * conocer lib/agenda.
 */
export { horaRetiroDeEutanasia }
