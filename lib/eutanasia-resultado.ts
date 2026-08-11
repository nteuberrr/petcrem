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
import { getSheetData, updateById, updateByIdIf, deleteRow, deleteById, appendRow, getNextId } from './datastore'
import { getConsultaEutanasia } from './eutanasia-precios'
import { enviarClienteAgradecimientoEutanasia, enviarMailNoRealizada, enviarVetEutanasiaCancelada } from './eutanasia-mailer'
import { formatDateForSheet, formatHora, fechaChileISO, formatDate } from './dates'
import { retiroPendiente, ahoraEnChile } from './ficha-retiro'
import { avisarAdminsWhatsapp } from './whatsapp'
import { MotivoNoRealizada, opcionNoRealizada } from './eutanasia-motivos'

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
        if (ci !== -1 && (clientes[ci].estado || '') === 'borrador') {
          await cancelarRetirosDeFicha(String(updated.cliente_id))
          await deleteRow('clientes', ci)
        }
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
 * Saca de la AGENDA los retiros pendientes de una ficha que se está eliminando.
 *
 * La agenda no se arma con `clientes` sino con `solicitudes_retiro`: si la ficha
 * se borra sin cancelar su solicitud, el cuadro sigue en el calendario y el
 * horario sigue ocupado (mismo bug que motivó `limpiarAgendaDeFicha` en el
 * DELETE de clientes). Best-effort: nunca frena el borrado.
 */
async function cancelarRetirosDeFicha(clienteId: string): Promise<void> {
  if (!clienteId) return
  try {
    const sols = await getSheetData('solicitudes_retiro')
    const ahora = new Date().toISOString()
    for (const s of sols) {
      if (String(s.cliente_id || '').trim() !== clienteId) continue
      if (!['pendiente', 'confirmada'].includes((s.estado || '').trim().toLowerCase())) continue
      // Condicional sobre el estado: si el equipo la está resolviendo en este
      // mismo momento desde el panel, gana esa operación y no la pisamos.
      await updateByIdIf('solicitudes_retiro', s.id, { estado: s.estado },
        { estado: 'cancelada', fecha_resolucion: ahora })
    }
  } catch (e) {
    console.warn('[eutanasia-resultado] no se pudo cancelar la solicitud de retiro:', e)
  }
}

/**
 * SE CANCELÓ TODO: no hay eutanasia NI cremación.
 *
 * Es la salida de "la familia dio marcha atrás". A diferencia de
 * `cancelarEutanasiaConservandoFicha` (la mascota falleció antes y la cremación
 * sigue), acá también se cae el servicio de cremación: la ficha borrador se
 * elimina junto con su bloque en la agenda. Una ficha YA REGISTRADA no se toca
 * —puede haber gestión, cobro o retiro hecho— y se devuelve un aviso para que el
 * equipo decida a mano desde /clientes.
 *
 * No se le paga al veterinario ni se le cobra al tutor (`cobroClienteCon` y
 * `pagoVetCon` ya devuelven 0 para 'cancelada').
 */
export async function cancelarEutanasiaYCremacion(
  id: string,
  opts: { motivo?: string } = {},
): Promise<{ ok: true; cotizacion: Record<string, string>; aviso?: string } | { ok: false; error: string; status: number }> {
  const rows = await getSheetData(SHEET)
  const row = rows.find(r => String(r.id) === String(id))
  if (!row) return { ok: false, error: 'No encontrado', status: 404 }
  if (['realizada', 'no_realizada', 'cancelada'].includes(row.estado || '')) {
    return { ok: false, error: `Esta eutanasia ya está cerrada (${row.estado}).`, status: 400 }
  }

  const ahora = new Date().toISOString()
  const motivo = (opts.motivo || opcionNoRealizada('cancelado').nota).trim()

  // La cremación se resuelve ANTES de escribir la cotización: si la ficha se
  // elimina, `cliente_id` tiene que quedar vacío en la misma escritura (si no,
  // los enlaces "Ver ficha de cremación" apuntan a una fila que ya no existe).
  let aviso = ''
  let eliminarFicha = false
  const clienteId = String(row.cliente_id || '').trim()
  if (clienteId) {
    try {
      const clientes = await getSheetData('clientes')
      const ficha = clientes.find(c => String(c.id) === clienteId)
      if (ficha) {
        if ((ficha.estado || '').trim().toLowerCase() === 'borrador') {
          eliminarFicha = true
        } else {
          aviso = `La ficha de cremación${ficha.codigo ? ` ${ficha.codigo}` : ''} ya estaba registrada: se conservó. ` +
            'Si la cremación tampoco se hace, elimínala desde /clientes.'
        }
      }
    } catch (e) {
      console.warn('[eutanasia-resultado] no se pudo leer la ficha de cremación:', e)
    }
  }

  const partial: Record<string, string> = {
    estado: 'cancelada',
    fecha_cancelacion: ahora,
    // Sin pago al vet ni cobro al tutor: se limpian los campos de un eventual
    // cierre previo para que no quede un pago fantasma en los pendientes.
    estado_pago: '',
    fecha_realizacion: '',
    consulta_vet_snapshot: '',
    notas: `${row.notas ? `${row.notas} · ` : ''}${motivo}`,
    ...(eliminarFicha ? { cliente_id: '' } : {}),
  }
  const updated = { ...row, ...partial }
  await updateById(SHEET, String(id), updated)

  if (eliminarFicha) {
    try {
      await cancelarRetirosDeFicha(clienteId)
      await deleteById('clientes', clienteId)
    } catch (e) {
      console.warn('[eutanasia-resultado] no se pudo eliminar la ficha borrador:', e)
      aviso = 'La eutanasia quedó cancelada, pero no se pudo eliminar el borrador de la ficha de cremación: bórralo desde /clientes.'
    }
  }

  // Cerrar el círculo con la veterinaria que tenía la visita tomada.
  if (row.vet_email_asignado) {
    try {
      await enviarVetEutanasiaCancelada({
        email: row.vet_email_asignado,
        vetNombre: row.vet_nombre_asignado || '',
        mascota: row.mascota_nombre || '',
        motivo,
      })
    } catch (e) { console.warn('[eutanasia-resultado] aviso de cancelación al vet falló:', e) }
  }

  try {
    await avisarAdminsWhatsapp(
      `🚫 *Eutanasia cancelada* (N° ${id})\n\n` +
      `Mascota: ${row.mascota_nombre}\nTutor: ${row.cliente_nombre}\n` +
      `${motivo}\n` +
      `Sin cobro de eutanasia${row.vet_nombre_asignado ? ` (le avisamos a ${row.vet_nombre_asignado})` : ''}.\n` +
      (aviso || (eliminarFicha
        ? 'Tampoco hay cremación: se eliminó la ficha.'
        : 'No había ficha de cremación asociada.')))
  } catch (e) { console.warn('[eutanasia-resultado] aviso al equipo falló:', e) }

  return { ok: true, cotizacion: updated, ...(aviso ? { aviso } : {}) }
}

/**
 * CIERRE "no se realizó" según su MOTIVO — la fuente única de las tres salidas
 * que ofrece el modal (ver lib/eutanasia-motivos). Cada una cierra el caso
 * distinto en las dos cosas que importan: el pago al veterinario y la cremación.
 */
export async function aplicarNoRealizada(
  id: string,
  motivo: MotivoNoRealizada,
): Promise<{ ok: true; cotizacion: Record<string, string>; aviso?: string } | { ok: false; error: string; status: number }> {
  const nota = opcionNoRealizada(motivo).nota
  if (motivo === 'cancelado') return cancelarEutanasiaYCremacion(id, { motivo: nota })
  if (motivo === 'mascota_fallecio') return cancelarEutanasiaConservandoFicha(id, { motivo: nota })
  // 'vet_no_realizo': fue, evaluó y no correspondía → se le paga la consulta.
  return aplicarResultadoEutanasia(id, 'no_realizada')
}

/**
 * SERVICIO CANCELADO: la eutanasia no se hace y NO se cobra a nadie, pero la
 * FICHA de cremación sigue viva.
 *
 * Caso real (Mila, 30-07-2026): estaba todo coordinado con la veterinaria y la
 * mascota falleció antes de la visita. La familia igual necesita la cremación
 * —de hecho el chofer ya la retiró y la ficha quedó ingresada con un pago
 * parcial por ese servicio—, pero la eutanasia no corre.
 *
 * Con las dos salidas que existían no se podía cerrar bien:
 *  · "No realizada" BORRA la ficha de cremación (asume que la mascota sigue
 *    viva) y además le genera el pago fijo de la consulta a la veterinaria;
 *  · "Cancelada" desde el panel conserva la ficha, pero saca el bloque de la
 *    agenda — y la ficha sola no aparece en el calendario (la agenda lee
 *    `solicitudes_retiro`), así que un retiro AÚN PENDIENTE se volvía invisible.
 *
 * Esto cierra la eutanasia como 'cancelada' (sin pago al vet ni cobro al tutor,
 * ver cobroClienteCon), deja la ficha intacta y —solo si el retiro todavía NO se
 * ha hecho— crea su solicitud de retiro CONFIRMADA ligada a la misma ficha, para
 * que el chofer lo siga viendo en la agenda. Si la cremación también se cae, la
 * ficha se elimina desde /clientes como cualquier otra (y eso ya cancela su
 * solicitud, ver el DELETE de clientes).
 */
export async function cancelarEutanasiaConservandoFicha(
  id: string,
  opts: { motivo?: string } = {},
): Promise<{ ok: true; cotizacion: Record<string, string>; solicitudId: string } | { ok: false; error: string; status: number }> {
  const rows = await getSheetData(SHEET)
  const row = rows.find(r => String(r.id) === String(id))
  if (!row) return { ok: false, error: 'No encontrado', status: 404 }
  if (['realizada', 'no_realizada', 'cancelada'].includes(row.estado || '')) {
    return { ok: false, error: `Esta eutanasia ya está cerrada (${row.estado}).`, status: 400 }
  }

  const ahora = new Date().toISOString()
  const motivo = (opts.motivo || 'Servicio cancelado: la eutanasia no se realizó.').trim()
  const partial: Record<string, string> = {
    estado: 'cancelada',
    fecha_cancelacion: ahora,
    notas: `${row.notas ? `${row.notas} · ` : ''}${motivo}`,
  }
  const updated = { ...row, ...partial }
  await updateById(SHEET, String(id), updated)

  // ¿Queda un retiro por hacer? Si la mascota todavía no se retira, el bloque
  // tiene que seguir en la agenda: se convierte en un retiro de cremación normal
  // ligado a la MISMA ficha (nunca una segunda). Si el retiro ya se hizo, no hay
  // nada que agendar.
  let solicitudId = ''
  const clienteId = String(row.cliente_id || '').trim()
  if (clienteId) {
    const [clientes, solicitudes] = await Promise.all([
      getSheetData('clientes').catch(() => [] as Record<string, string>[]),
      getSheetData('solicitudes_retiro').catch(() => [] as Record<string, string>[]),
    ])
    const ficha = clientes.find(c => String(c.id) === clienteId)
    const yaTiene = solicitudes.find(s =>
      String(s.cliente_id || '') === clienteId && ['pendiente', 'confirmada'].includes(s.estado || ''))
    const pendiente = !!ficha && retiroPendiente(ficha, ahoraEnChile())
    if (ficha && !yaTiene && pendiente) {
      const fecha = formatDateForSheet(ficha.fecha_retiro) || formatDateForSheet(row.fecha_servicio) || ''
      const hora = formatHora(ficha.hora_retiro) || formatHora(row.hora_retiro_crematorio) || ''
      solicitudId = String(await getNextId('solicitudes_retiro'))
      await appendRow('solicitudes_retiro', {
        id: solicitudId,
        cliente_wa_id: (row.cliente_wa_id || row.cliente_telefono || '').replace(/\D/g, ''),
        cliente_nombre: row.cliente_nombre || '',
        nombre_mascota: row.mascota_nombre || '',
        peso: row.peso || '',
        direccion: row.direccion || '',
        comuna: row.comuna || '',
        fecha_retiro: fecha,
        hora_retiro: hora,
        tipo_servicio: row.tipo_servicio_cremacion || '',
        estado: 'confirmada',
        fecha_creacion: fechaChileISO(),
        fecha_resolucion: ahora,
        origen: 'eutanasia_cancelada',
        cliente_id: clienteId,
      })
    }
  }

  // Cerrar el círculo con la veterinaria que tenía la visita tomada: se quedaba
  // esperando una visita que ya no era.
  if (row.vet_email_asignado) {
    try {
      await enviarVetEutanasiaCancelada({
        email: row.vet_email_asignado,
        vetNombre: row.vet_nombre_asignado || '',
        mascota: row.mascota_nombre || '',
        motivo,
      })
    } catch (e) { console.warn('[eutanasia-resultado] aviso de cancelación al vet falló:', e) }
  }

  try {
    await avisarAdminsWhatsapp(
      `🚫 *Eutanasia cancelada* (N° ${id})\n\n` +
      `Mascota: ${row.mascota_nombre}\nTutor: ${row.cliente_nombre}\n` +
      `${motivo}\n` +
      `Sin cobro de eutanasia${row.vet_nombre_asignado ? ` (le avisamos a ${row.vet_nombre_asignado})` : ''}.\n` +
      (solicitudId
        ? `La ficha sigue abierta y el retiro quedó agendado (N° ${solicitudId}, ${formatDate(row.fecha_servicio)}).`
        : 'La ficha de cremación sigue abierta.'))
  } catch (e) { console.warn('[eutanasia-resultado] aviso al equipo falló:', e) }

  return { ok: true, cotizacion: updated, solicitudId }
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
