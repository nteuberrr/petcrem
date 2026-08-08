import { getSheetData, appendRow, getNextId, updateById, deleteById } from './datastore'
import { getContacto } from './email-layout'
import { buildCobroAdicional, type CobroItem } from './cliente-mailer'
import { sendEmail, isResendConfigured } from './resend-mailer'
import { registrarEnvio } from './correos-log'
import { enviarTextoWhatsapp, isWhatsappConfigured } from './whatsapp'
import { createCobroToken } from './cobro-token'
import { fmtPrecio } from './format'
import { yaFueRetirada } from './ficha-retiro'

/**
 * Cobros pendientes de una ficha (tabla `cobros`). Unifica los dos cobros que
 * perseguimos: por PRODUCTO ADICIONAL agregado al servicio y por DIFERENCIA de
 * peso. Estados: pendiente → cliente_confirmo (el tutor apretó "confirmé la
 * transferencia" en el correo) → pagado (el equipo lo confirma en la ficha).
 * Todo best-effort en los envíos: nunca rompe la operación que lo dispara.
 */

const TABLE = 'cobros'
// 'saldo' = diferencia pendiente de un PAGO PARCIAL de la ficha (el tutor abonó
// una parte y queda el resto por pagar). Se controla internamente (sin correo);
// al confirmarlo pagado, la ficha queda 'pagado' y recién ahí se emite la boleta.
//
// 'devolucion' = plata que va PARA EL OTRO LADO: se le debe al tutor, porque su
// boleta cobró más de lo que el servicio terminó valiendo (típicamente al
// registrar un peso real de un tramo más barato — ver lib/devolucion). Vive en la
// misma tabla porque comparte todo el circuito —banner en la ficha, notificación,
// informe diario, botón de confirmar— pero su monto NO es "por cobrar": quien lo
// consuma tiene que restarlo o mostrarlo aparte, nunca sumarlo a lo que el tutor
// debe. Al confirmarlo se emite una NOTA DE CRÉDITO sobre la boleta de la ficha,
// no una boleta nueva.
export type TipoCobro = 'adicional' | 'diferencia' | 'saldo' | 'devolucion'
export type EstadoCobro = 'pendiente' | 'cliente_confirmo' | 'pagado'

/** ¿Este movimiento es plata que le devolvemos al tutor (y no que nos deba)? */
export function esDevolucion(tipo: string): boolean {
  return String(tipo || '') === 'devolucion'
}

export interface Cobro {
  id: string
  cliente_id: string
  tipo: string
  detalle: string
  monto: string
  estado: string
  message_id: string
  fecha_creacion: string
  fecha_cliente_confirmo: string
  fecha_pagado: string
  /** Boleta (39) emitida por este cobro al confirmarse el pago. '' = sin emitir. */
  boleta_id: string
}

// ⚠️ toCobro DEBE mapear todas las columnas: `marcarCobroPagado`/`marcarClienteConfirmo`
// escriben con updateById (fila COMPLETA), así que un campo que no viaje en el
// objeto se persiste como '' y se pierde (mismo bug que borraba clientes.boleta_id).
function toCobro(r: Record<string, string>): Cobro {
  return {
    id: r.id || '', cliente_id: r.cliente_id || '', tipo: r.tipo || '', detalle: r.detalle || '',
    monto: r.monto || '0', estado: r.estado || 'pendiente', message_id: r.message_id || '',
    fecha_creacion: r.fecha_creacion || '', fecha_cliente_confirmo: r.fecha_cliente_confirmo || '', fecha_pagado: r.fecha_pagado || '',
    boleta_id: r.boleta_id || '',
  }
}

/** Crea un cobro (estado pendiente) y devuelve su id. */
export async function crearCobro(clienteId: string, tipo: TipoCobro, detalle: string, monto: number): Promise<string> {
  const id = await getNextId(TABLE)
  await appendRow(TABLE, {
    id, cliente_id: String(clienteId), tipo, detalle: detalle.slice(0, 500), monto: String(Math.round(monto)),
    estado: 'pendiente', message_id: '', fecha_creacion: new Date().toISOString(), fecha_cliente_confirmo: '', fecha_pagado: '',
    boleta_id: '',
  })
  return String(id)
}

/** Anota en el cobro la boleta que se emitió por él. */
export async function marcarBoletaCobro(id: string, boletaId: string): Promise<void> {
  const c = await obtenerCobro(id)
  if (!c) return
  await updateById(TABLE, id, { ...c, boleta_id: String(boletaId) })
}

/**
 * TODOS los cobros de una ficha (pagados incluidos), del más antiguo al más
 * nuevo. Es lo que la ficha muestra en el resumen: un cobro no es plata extra
 * —el snapshot de la ficha ya lo contempla— sino una parte del total que se
 * cobró aparte, y sin verlo el equipo no entiende de dónde sale el monto.
 */
export async function cobrosPorCliente(clienteId: string): Promise<Cobro[]> {
  if (!clienteId) return []
  try {
    const rows = (await getSheetData(TABLE)).map(toCobro)
    return rows
      .filter(c => c.cliente_id === String(clienteId))
      .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0))
  } catch {
    return []
  }
}

/** Cobros NO pagados de una ficha (para el banner "cobro pendiente"). */
export async function cobrosPendientesPorCliente(clienteId: string): Promise<Cobro[]> {
  if (!clienteId) return []
  try {
    const rows = (await getSheetData(TABLE)).map(toCobro)
    return rows.filter(c => c.cliente_id === String(clienteId) && c.estado !== 'pagado')
      .sort((a, b) => (parseInt(b.id, 10) || 0) - (parseInt(a.id, 10) || 0))
  } catch { return [] }
}

/** TODOS los cobros no pagados (para la notificación global arriba de /clientes). */
export async function cobrosPendientesTodos(): Promise<Cobro[]> {
  try {
    return (await getSheetData(TABLE)).map(toCobro)
      .filter(c => c.estado !== 'pagado' && c.cliente_id)
      .sort((a, b) => (parseInt(b.id, 10) || 0) - (parseInt(a.id, 10) || 0))
  } catch { return [] }
}

export async function obtenerCobro(id: string): Promise<Cobro | null> {
  const rows = await getSheetData(TABLE)
  const r = rows.find(x => String(x.id) === String(id))
  return r ? toCobro(r) : null
}

/** El cliente confirmó (desde el correo) que hizo la transferencia. Idempotente. */
export async function marcarClienteConfirmo(id: string): Promise<Cobro | null> {
  const c = await obtenerCobro(id)
  if (!c) return null
  if (c.estado === 'pendiente') {
    await updateById(TABLE, id, { ...c, estado: 'cliente_confirmo', fecha_cliente_confirmo: new Date().toISOString() })
    return { ...c, estado: 'cliente_confirmo' }
  }
  return c
}

/** El equipo confirmó el pago recibido (desde la ficha). Cierra la cobranza. */
export async function marcarCobroPagado(id: string): Promise<Cobro | null> {
  const c = await obtenerCobro(id)
  if (!c) return null
  await updateById(TABLE, id, { ...c, estado: 'pagado', fecha_pagado: new Date().toISOString() })
  return { ...c, estado: 'pagado' }
}

/**
 * PAGO PARCIAL — mantiene UN cobro abierto tipo 'saldo' por el monto `pendiente`
 * (Total − abono). Crea si no hay ninguno abierto; actualiza el monto si el abono
 * cambió; no toca los ya pagados. Sin correo/WhatsApp: es control interno (el
 * equipo confirma el pago desde el banner de la ficha / la notificación).
 */
export async function sincronizarSaldoParcial(clienteId: string, pendiente: number): Promise<void> {
  if (!clienteId || pendiente <= 0) return
  const monto = Math.round(pendiente)
  const abierto = (await getSheetData(TABLE)).map(toCobro)
    .find(c => c.cliente_id === String(clienteId) && c.tipo === 'saldo' && c.estado !== 'pagado')
  if (abierto) {
    if (Number(abierto.monto) !== monto) {
      await updateById(TABLE, abierto.id, { ...abierto, monto: String(monto), detalle: 'Saldo pendiente (pago parcial)' })
    }
    return
  }
  await crearCobro(clienteId, 'saldo', 'Saldo pendiente (pago parcial)', monto)
}

/** Cierra (marca pagado) cualquier saldo parcial abierto de una ficha. */
export async function cerrarSaldoParcial(clienteId: string): Promise<void> {
  if (!clienteId) return
  const abiertos = (await getSheetData(TABLE)).map(toCobro)
    .filter(c => c.cliente_id === String(clienteId) && c.tipo === 'saldo' && c.estado !== 'pagado')
  for (const c of abiertos) await marcarCobroPagado(c.id)
}

/**
 * DEVOLUCIÓN AL TUTOR — mantiene UNA devolución abierta por ficha con el monto
 * que hoy corresponde devolverle (ver [lib/devolucion.ts](devolucion.ts)).
 * Se llama en cada guardado de la ficha, así que tiene que ser idempotente:
 *
 *  · sin devolución abierta y `monto > 0` → la crea
 *  · con una abierta y el monto cambió (se corrigió el peso otra vez) → la ajusta
 *  · `monto <= 0` (el peso volvió a su tramo, o ya no corresponde) → BORRA la
 *    abierta. Se borra y no se marca pagada a propósito: marcarla pagada diría que
 *    le devolvimos plata al tutor, que es justo lo contrario de lo que pasó.
 *
 * Nunca toca una devolución ya PAGADA: esa ya tiene su nota de crédito emitida.
 */
export async function sincronizarDevolucion(
  clienteId: string,
  monto: number,
  detalle: string,
): Promise<void> {
  if (!clienteId) return
  const abierta = (await getSheetData(TABLE)).map(toCobro)
    .find(c => c.cliente_id === String(clienteId) && esDevolucion(c.tipo) && c.estado !== 'pagado')
  const redondeado = Math.round(monto)

  if (redondeado <= 0) {
    if (abierta) await deleteById(TABLE, abierta.id)
    return
  }
  if (!abierta) {
    await crearCobro(clienteId, 'devolucion', detalle, redondeado)
    return
  }
  if (Number(abierta.monto) !== redondeado || abierta.detalle !== detalle.slice(0, 500)) {
    await updateById(TABLE, abierta.id, { ...abierta, monto: String(redondeado), detalle: detalle.slice(0, 500) })
  }
}

/** Lee los datos de transferencia de empresa_config (los vacíos se omiten en el correo). */
async function datosTransferencia() {
  const cfgRows = await getSheetData('empresa_config').catch(() => [] as Record<string, string>[])
  const cfg = cfgRows.find(r => r.id === '1') || cfgRows[0] || {}
  // Titular de la CUENTA (Industrias NC SpA) ≠ nombre de marca (Crematorio Alma Animal).
  return { titular: cfg.titular_cuenta || cfg.nombre || '', rut: cfg.rut || '', banco: cfg.banco || '', tipoCuenta: cfg.tipo_cuenta || '', numeroCuenta: cfg.numero_cuenta || '', correo: cfg.correo || '' }
}

interface ClienteMin {
  id: string; email?: string; nombre_tutor?: string; nombre_mascota?: string; telefono?: string
}

/**
 * ¿Corresponde COBRAR APARTE un producto que se acaba de agregar a la ficha
 * (correo con datos de transferencia + WhatsApp + "pendiente de pago"), o el
 * adicional simplemente se suma al total del servicio?
 *
 * Se cobra aparte solo cuando el servicio YA ESTÁ CERRADO, es decir las dos:
 *
 *  1. La mascota ya fue retirada. Antes del retiro el adicional queda anotado en
 *     la ficha y lo cobra el CHOFER en el momento (casos Mona y Channel: se le
 *     mandó el cobro por transferencia a alguien que todavía no nos entregaba a
 *     su mascota).
 *  2. La ficha ya estaba SALDADA ANTES de este cambio — pagada, o con su boleta
 *     ya emitida. Si todavía no lo estaba, el adicional viaja DENTRO de
 *     `precio_total` (la ficha y el bot recalculan el snapshot al agregarlo) y lo
 *     cubre el pago/boleta que falta: cobrarlo aparte sería cobrarlo dos veces.
 *
 * El punto 2 es el que faltaba (caso Mochi G136-CP, 2026-08-07): el relicario se
 * agregó a los 11 minutos del retiro, con el chofer todavía ahí cobrando el total
 * — el sistema lo dio por "ya retirada" y le mandó al tutor un cobro de $16.000
 * que ya estaba pagado y que la boleta de la ficha incluía. Es la misma guarda que
 * ya tenía `emitirBoletaCobroSiCorresponde` en [lib/facturacion.ts](facturacion.ts)
 * para no emitir dos DTE, ahora aplicada un paso antes: sin cobro no hay correo.
 *
 * ⚠️ `antes` tiene que ser la fila COMO ESTABA antes del request. Si se le pasa
 * la ya mergeada, un guardado que en la misma pasada agrega el adicional y marca
 * la ficha como pagada se leería como "ya estaba saldada" y volvería a cobrar.
 */
export function correspondeCobrarAdicional(
  ficha: { codigo?: string; estado?: string; fecha_retiro?: string; hora_retiro?: string },
  antes: { estado_pago?: string; boleta_id?: string },
  ahora: { iso: string; min: number },
): boolean {
  if (!yaFueRetirada(ficha, ahora)) return false
  return String(antes.estado_pago || '').toLowerCase() === 'pagado' ||
    String(antes.boleta_id || '').trim() !== ''
}

/**
 * DISPARA el cobro de uno o varios productos adicionales agregados al servicio:
 * crea el cobro, envía el correo (con botón "confirma tu transferencia") y el
 * WhatsApp al tutor. Lo llaman el alta manual en la ficha y la herramienta del bot.
 * Devuelve el id del cobro creado, o null si no había email/ítems.
 */
export async function dispararCobroAdicional(cliente: ClienteMin, items: CobroItem[]): Promise<string | null> {
  const validos = items.filter(i => i.nombre && (i.precio || 0) > 0)
  if (validos.length === 0) return null
  const monto = validos.reduce((s, i) => s + (i.precio || 0) * (i.qty || 1), 0)
  const detalle = validos.map(i => `${i.qty && i.qty > 1 ? `${i.qty}× ` : ''}${i.nombre}`).join(', ')

  // DEDUP (caso real Morita G106, 2026-07-11: 3 cobros idénticos del mismo
  // relicario, con 3 correos): si esta ficha YA tiene un cobro adicional IGUAL
  // (mismo detalle y monto) que aún no está pagado, NO se crea otro — un
  // re-llamado del bot o un re-guardado de la ficha con estado desactualizado
  // no debe volver a cobrar lo mismo. Si el anterior ya está pagado, sí se
  // permite (compra repetida legítima).
  try {
    const previos = (await getSheetData(TABLE)).map(toCobro)
    const dup = previos.find(c =>
      c.cliente_id === String(cliente.id) && c.tipo === 'adicional' &&
      c.estado !== 'pagado' && c.detalle === detalle.slice(0, 500) && Number(c.monto) === Math.round(monto)
    )
    if (dup) {
      console.warn(`[cobros] dedup: la ficha ${cliente.id} ya tiene el cobro ${dup.id} ("${detalle}", ${monto}) sin pagar — no se crea otro ni se reenvía el correo.`)
      return dup.id
    }
  } catch { /* best-effort: si la lectura falla, se sigue con el cobro normal */ }

  const cobroId = await crearCobro(cliente.id, 'adicional', detalle, monto)

  const email = (cliente.email || '').trim()
  const tel = (cliente.telefono || '').replace(/\D/g, '').slice(-9)

  if (email && isResendConfigured()) {
    try {
      const [contacto, transf] = await Promise.all([getContacto(), datosTransferencia()])
      const opts = buildCobroAdicional({
        email,
        nombreMascota: cliente.nombre_mascota || 'tu mascota',
        nombreTutor: cliente.nombre_tutor || '',
        clienteId: String(cliente.id),
        items: validos, monto, transferencia: transf,
        linkConfirma: `${(process.env.PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'https://petcrem.vercel.app').replace(/\/+$/, '')}/pago/confirma/${encodeURIComponent(createCobroToken(cobroId))}`,
      }, contacto)
      const res = await sendEmail(opts)
      await registrarEnvio({ clienteId: String(cliente.id), tipo: 'cobro_adicional', email, messageId: res.message_id, ok: res.ok, error: res.error })
      if (res.message_id) { const c = await obtenerCobro(cobroId); if (c) await updateById(TABLE, cobroId, { ...c, message_id: res.message_id }) }
    } catch (e) { console.warn('[cobros] correo adicional falló:', e instanceof Error ? e.message : e) }
  }

  if (tel.length === 9 && isWhatsappConfigured()) {
    try {
      await enviarTextoWhatsapp(`56${tel}`,
        `Hola ${cliente.nombre_tutor || ''} 🐾 Según lo solicitado, agregamos al servicio de ${cliente.nombre_mascota || 'tu mascota'}: ${detalle}. ` +
        `Total a pagar: ${fmtPrecio(monto)}. Te enviamos un correo a ${email} con el detalle y los datos de transferencia. ` +
        `Cuando transfieras, puedes confirmarlo desde el mismo correo. ¡Gracias!`)
    } catch (e) { console.warn('[cobros] whatsapp adicional falló:', e) }
  }

  return cobroId
}
