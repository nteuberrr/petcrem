import { getSheetData, appendRow, getNextId, updateById } from './datastore'
import { getContacto } from './email-layout'
import { buildCobroAdicional, type CobroItem } from './cliente-mailer'
import { sendEmail, isResendConfigured } from './resend-mailer'
import { registrarEnvio } from './correos-log'
import { enviarTextoWhatsapp, isWhatsappConfigured } from './whatsapp'
import { createCobroToken } from './cobro-token'
import { fmtPrecio } from './format'

/**
 * Cobros pendientes de una ficha (tabla `cobros`). Unifica los dos cobros que
 * perseguimos: por PRODUCTO ADICIONAL agregado al servicio y por DIFERENCIA de
 * peso. Estados: pendiente → cliente_confirmo (el tutor apretó "confirmé la
 * transferencia" en el correo) → pagado (el equipo lo confirma en la ficha).
 * Todo best-effort en los envíos: nunca rompe la operación que lo dispara.
 */

const TABLE = 'cobros'
export type TipoCobro = 'adicional' | 'diferencia'
export type EstadoCobro = 'pendiente' | 'cliente_confirmo' | 'pagado'

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
}

function toCobro(r: Record<string, string>): Cobro {
  return {
    id: r.id || '', cliente_id: r.cliente_id || '', tipo: r.tipo || '', detalle: r.detalle || '',
    monto: r.monto || '0', estado: r.estado || 'pendiente', message_id: r.message_id || '',
    fecha_creacion: r.fecha_creacion || '', fecha_cliente_confirmo: r.fecha_cliente_confirmo || '', fecha_pagado: r.fecha_pagado || '',
  }
}

/** Crea un cobro (estado pendiente) y devuelve su id. */
export async function crearCobro(clienteId: string, tipo: TipoCobro, detalle: string, monto: number): Promise<string> {
  const id = await getNextId(TABLE)
  await appendRow(TABLE, {
    id, cliente_id: String(clienteId), tipo, detalle: detalle.slice(0, 500), monto: String(Math.round(monto)),
    estado: 'pendiente', message_id: '', fecha_creacion: new Date().toISOString(), fecha_cliente_confirmo: '', fecha_pagado: '',
  })
  return String(id)
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
