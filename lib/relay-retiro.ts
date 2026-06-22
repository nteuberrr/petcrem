import { getSheetData, appendRow, getNextId, updateByIdIf, ensureSheet, ensureColumns } from './datastore'
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
 * El ÚNICO relay pendiente, o null si hay 0 o MÁS DE UNO. Permite que el admin
 * responda sin citar SOLO cuando es inequívoco (una sola consulta abierta). Si
 * hay varias, debe citar el aviso correspondiente; si no cita, su mensaje no se
 * reenvía a nadie. Antes esto tomaba "el más reciente", lo que podía secuestrar
 * cualquier texto del admin y reenviarlo a un cliente equivocado.
 */
export async function buscarRelayPendienteUnico(): Promise<RelayRetiroRow | null> {
  const rows = await getSheetData(TABLE)
  const pend = rows.filter(r => r.estado === 'pendiente')
  return pend.length === 1 ? (pend[0] as unknown as RelayRetiroRow) : null
}

/**
 * Reclama un relay de forma ATÓMICA (pendiente → respondida). Devuelve true solo
 * si esta llamada ganó el cambio; false si otra ejecución ya lo había respondido.
 * Llamar ANTES de reenviar al cliente para no duplicar el envío ante una
 * re-entrega del webhook o dos respuestas del admin casi simultáneas.
 */
export async function marcarRelayRespondida(id: string): Promise<boolean> {
  return updateByIdIf(
    TABLE,
    id,
    { estado: 'pendiente' },
    { estado: 'respondida', fecha_respuesta: new Date().toISOString() },
  )
}
