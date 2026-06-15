import { getSheetData, appendRow, getNextId, updateById, ensureSheet, ensureColumns } from './datastore'
import { todayISO } from './dates'

/**
 * Relay de la consulta "¿cuánto falta para el retiro?".
 *
 * Flujo: el cliente pregunta → el agente avisa al admin por WhatsApp y guarda el
 * message_id de ESE aviso en relay_retiro (estado 'pendiente'). Cuando el admin
 * RESPONDE CITANDO ese mensaje, el webhook (procesarRelayAdmin) busca el pendiente
 * por admin_msg_id (= context.id de la cita) y reenvía la respuesta al cliente.
 */

const TABLE = 'relay_retiro'
const COLS = ['id', 'admin_msg_id', 'cliente_wa_id', 'cliente_nombre', 'mascota', 'pregunta', 'estado', 'fecha_creacion', 'fecha_respuesta']

export interface RelayRetiroRow {
  id: string
  admin_msg_id: string
  cliente_wa_id: string
  cliente_nombre: string
  mascota: string
  pregunta: string
  estado: string
  fecha_creacion: string
  fecha_respuesta: string
}

export async function crearRelayPendiente(input: {
  adminMsgId: string
  clienteWaId: string
  clienteNombre?: string
  mascota?: string
  pregunta?: string
}): Promise<string> {
  await ensureSheet(TABLE)
  await ensureColumns(TABLE, COLS)
  const id = await getNextId(TABLE)
  await appendRow(TABLE, {
    id,
    admin_msg_id: input.adminMsgId,
    cliente_wa_id: (input.clienteWaId || '').replace(/\D/g, ''),
    cliente_nombre: input.clienteNombre || '',
    mascota: input.mascota || '',
    pregunta: (input.pregunta || '').slice(0, 300),
    estado: 'pendiente',
    fecha_creacion: todayISO(),
    fecha_respuesta: '',
  })
  return String(id)
}

/** Busca un relay pendiente por el message_id del aviso al admin (context.id de la cita). */
export async function buscarRelayPendientePorMsg(adminMsgId: string): Promise<RelayRetiroRow | null> {
  if (!adminMsgId) return null
  const rows = await getSheetData(TABLE)
  const row = rows.find(r => r.admin_msg_id === adminMsgId && r.estado === 'pendiente')
  return (row as RelayRetiroRow | undefined) ?? null
}

/**
 * El relay pendiente MÁS RECIENTE (mayor id). Permite que el admin responda sin
 * citar: su respuesta se asocia a la última consulta abierta. Si hay varias
 * abiertas a la vez, conviene que cite el aviso correspondiente.
 */
export async function buscarRelayPendienteMasReciente(): Promise<RelayRetiroRow | null> {
  const rows = await getSheetData(TABLE)
  const pend = rows.filter(r => r.estado === 'pendiente')
  if (pend.length === 0) return null
  pend.sort((a, b) => (parseInt(b.id, 10) || 0) - (parseInt(a.id, 10) || 0))
  return pend[0] as unknown as RelayRetiroRow
}

export async function marcarRelayRespondida(id: string): Promise<void> {
  const rows = await getSheetData(TABLE)
  const row = rows.find(r => String(r.id) === String(id))
  if (!row) return
  await updateById(TABLE, id, { ...row, estado: 'respondida', fecha_respuesta: new Date().toISOString() })
}
