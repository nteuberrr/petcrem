/**
 * Cierre de una cotización de eutanasia con su RESULTADO (realizada / no
 * realizada) y todos sus efectos: timestamps, pago al vet, borrador de cremación
 * y correos.
 *
 * Fuente ÚNICA de esa regla, compartida por:
 *  · PATCH /api/eutanasias/cotizaciones/[id]  — el panel de Servicios (admin);
 *  · POST  /api/eutanasias/ficha/[id]         — la ficha de la eutanasia que se
 *    abre desde el dashboard/agenda, disponible para TODOS los roles (pasa
 *    seguido que el veterinario no marca su enlace del correo y el caso queda
 *    trabado: nadie puede cerrar la ficha ni el pago).
 */
import { getSheetData, updateById, deleteRow } from './datastore'
import { getConsultaEutanasia } from './eutanasia-precios'
import { enviarClienteAgradecimientoEutanasia, enviarMailNoRealizada } from './eutanasia-mailer'

const SHEET = 'cotizaciones_eutanasia'

export type ResultadoEutanasia = 'realizada' | 'no_realizada'

export function esResultado(v: unknown): v is ResultadoEutanasia {
  return v === 'realizada' || v === 'no_realizada'
}

/**
 * Campos que se sellan al cerrar la cotización: fecha de cierre, estado de pago
 * inicial y —si no se realizó— el snapshot de la consulta que se le paga al vet.
 * `partial` son los campos que el caller ya va a escribir (no los pisamos).
 */
export async function camposResultado(
  row: Record<string, string>,
  estado: ResultadoEutanasia,
  partial: Record<string, string> = {},
): Promise<Record<string, string>> {
  const p: Record<string, string> = {}
  if (!row.fecha_realizacion && !partial.fecha_realizacion) p.fecha_realizacion = new Date().toISOString()
  // Inicializamos el estado de pago para que aparezca en el histórico esperando
  // que el admin marque 'pago_confirmado' luego de transferir.
  if (!row.estado_pago && !partial.estado_pago) p.estado_pago = 'pendiente_pago'
  if (estado === 'no_realizada' && !row.consulta_vet_snapshot && !partial.consulta_vet_snapshot) {
    p.consulta_vet_snapshot = String((await getConsultaEutanasia()).vet)
  }
  return p
}

/**
 * Efectos posteriores a persistir el resultado (best-effort, no rompen el guardado):
 *  · realizada    → agradecimiento + reseña al tutor;
 *  · no realizada → elimina el borrador de cremación (la mascota sigue viva) y
 *    le avisa al vet que se le paga la consulta.
 * Guardado contra reenvíos: solo corre si el estado CAMBIÓ.
 */
export async function efectosResultado(updated: Record<string, string>, estadoAnterior: string): Promise<void> {
  const estado = updated.estado || ''

  if (estado === 'realizada' && estadoAnterior !== 'realizada' && updated.cliente_email) {
    try {
      await enviarClienteAgradecimientoEutanasia({
        clienteEmail: updated.cliente_email,
        clienteNombre: updated.cliente_nombre,
        mascotaNombre: updated.mascota_nombre,
      })
    } catch (e) { console.warn('[eutanasia-resultado] agradecimiento al cliente falló:', e) }
  }

  if (estado === 'no_realizada' && estadoAnterior !== 'no_realizada') {
    if (updated.cliente_id) {
      try {
        const clientes = await getSheetData('clientes')
        const ci = clientes.findIndex(r => String(r.id) === String(updated.cliente_id))
        if (ci !== -1 && (clientes[ci].estado || '') === 'borrador') await deleteRow('clientes', ci)
      } catch (e) { console.warn('[eutanasia-resultado] no se pudo eliminar el borrador:', e) }
    }
    if (updated.vet_email_asignado) {
      try {
        await enviarMailNoRealizada({
          vetEmail: updated.vet_email_asignado,
          vetNombre: updated.vet_nombre_asignado || '',
          mascotaNombre: updated.mascota_nombre,
          consultaVet: parseInt(updated.consulta_vet_snapshot || '0', 10) || (await getConsultaEutanasia()).vet,
          fechaRealizacionISO: (updated.fecha_realizacion || new Date().toISOString()).slice(0, 10),
        })
      } catch (e) { console.warn('[eutanasia-resultado] correo no-realizada al vet falló:', e) }
    }
  }
}

/**
 * Cierra la cotización con su resultado. Idempotente: si ya estaba en ese estado
 * no reescribe ni reenvía correos.
 */
export async function aplicarResultadoEutanasia(
  id: string,
  estado: ResultadoEutanasia,
): Promise<{ ok: true; cotizacion: Record<string, string> } | { ok: false; error: string; status: number }> {
  const rows = await getSheetData(SHEET)
  const row = rows.find(r => String(r.id) === String(id))
  if (!row) return { ok: false, error: 'No encontrado', status: 404 }
  if ((row.estado || '') === 'cancelada') {
    return { ok: false, error: 'La cotización está cancelada: no se puede cerrar con un resultado.', status: 400 }
  }
  if ((row.estado || '') === estado) return { ok: true, cotizacion: row }

  const partial: Record<string, string> = { estado, ...(await camposResultado(row, estado)) }
  const updated = { ...row, ...partial }
  await updateById(SHEET, String(id), updated)
  await efectosResultado(updated, row.estado || '')
  return { ok: true, cotizacion: updated }
}
