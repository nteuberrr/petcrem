import { getSheetData } from './datastore'
import { abonadoDeDocumento } from './facturacion'
import { parseDecimalOr0, parsePeso } from './numbers'

/**
 * DEVOLUCIÓN AL TUTOR — el espejo del cobro por diferencia de peso.
 *
 * Cuando se registra el peso real y cae en un tramo MÁS BARATO que el declarado,
 * el snapshot de la ficha baja solo (el precio siempre se calcula con
 * `peso_ingreso`). Si el servicio ya se cobró y se boleteó, esa baja deja al tutor
 * con plata a favor: le cobramos de más y hay que devolvérsela, además de corregir
 * el documento ante el SII con una nota de crédito.
 *
 * ⚠️ La devolución NO es la diferencia entre tramos, es la diferencia contra la
 * BOLETA:
 *
 *     devolución = saldo de la boleta − precio_total actual de la ficha
 *
 * Parece un rodeo pero es la única medida correcta, y probarlo contra los datos
 * reales lo dejó claro: calculándolo por tramos, 15 fichas históricas abrían una
 * devolución falsa (P208 Cholo declaró 40 kg y pesó 20,5, pero su boleta ya decía
 * $135.000 — el precio de los 20,5 kg). Ahí no se cobró de más: el peso declarado
 * era una estimación del tutor que nunca llegó a cobrarse. Lo que hay que devolver
 * es exactamente lo que el documento cobró de más, que además es lo que la nota de
 * crédito tiene que acreditar.
 *
 * De ahí salen sus dos condiciones: sin boleta no hay nada que medir (ni que
 * corregir), y sin snapshot (`precio_total` en 0) el cálculo daría la boleta
 * entera. Las fichas de convenio quedan fuera: se facturan al veterinario, mensual
 * y a mano, y su corrección va por Descuentos Convenios → Ajustar saldo.
 */

export interface DevolucionPendiente {
  /** Monto a devolver, > 0. */
  monto: number
  /** Texto del movimiento: "Diferencia de peso (10 → 8 kg)". */
  detalle: string
  /** Boleta que hay que corregir con la nota de crédito. */
  boletaId: string
}

/**
 * Devolución pendiente de una ficha, o `null` si no corresponde ninguna.
 *
 * `dtes` se puede pasar ya leído para no releer la tabla por ficha (lo usa
 * cualquier recorrido masivo); si no viene, se lee acá.
 */
export async function calcularDevolucion(
  c: Record<string, string>,
  dtes?: Record<string, string>[],
): Promise<DevolucionPendiente | null> {
  const boletaId = String(c.boleta_id || '').trim()
  if (!boletaId) return null
  if (String(c.veterinaria_id || '').trim()) return null

  const total = parseDecimalOr0(c.precio_total)
  if (total <= 0) return null

  const docs = dtes ?? await getSheetData('documentos_tributarios').catch(() => [])
  const doc = docs.find(d => String(d.id) === boletaId)
  if (!doc) return null
  if (String(doc.estado || '') === 'anulado') return null

  // Saldo vivo del documento: lo emitido menos lo que ya se acreditó con notas
  // de crédito. Sin esto, corregir dos veces la misma boleta pediría devolver de
  // nuevo lo que ya se devolvió.
  const saldo = (parseDecimalOr0(doc.monto_total) || 0) - abonadoDeDocumento(boletaId, docs)
  const monto = Math.round(saldo - total)
  if (monto <= 0) return null

  return { monto, detalle: detalleDevolucion(c), boletaId }
}

/**
 * Por qué se devuelve. El peso es el caso que motivó todo esto, así que cuando el
 * peso real es menor al declarado se nombra explícitamente; si el total bajó por
 * otra razón (se sacó un adicional, un ajuste del dueño) se dice en genérico, sin
 * inventar un motivo.
 */
function detalleDevolucion(c: Record<string, string>): string {
  const declarado = parsePeso(c.peso_declarado)
  const ingreso = parsePeso(c.peso_ingreso)
  if (declarado > 0 && ingreso > 0 && ingreso < declarado) {
    return `Diferencia de peso a favor del tutor (${declarado} → ${ingreso} kg)`
  }
  return 'Diferencia a favor del tutor sobre lo boleteado'
}
