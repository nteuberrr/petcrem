import { getSheetData, appendRow, updateByIdIf, getNextId } from './datastore'
import { fechaChileISO } from './dates'

/**
 * AVISOS AL EQUIPO POR WHATSAPP — registro y recuperación.
 *
 * El problema que resuelve (incidente del 11-08-2026): Meta **acepta** un envío
 * que no va a entregar. Devuelve 200 con message_id y recién ~10 segundos más
 * tarde manda un `failed` por webhook. Como los avisos al equipo no se guardaban
 * en ninguna parte, ese webhook no tenía dónde escribir y el resultado se
 * descartaba: el sistema los daba por enviados y nadie se enteraba. Así pasaron
 * DÍAS con la cuenta bloqueada por el método de pago (error 141006 de Meta) sin
 * que llegara una sola solicitud de retiro al WhatsApp del equipo.
 *
 * Cómo queda cubierto:
 *   1. cada aviso enviado se REGISTRA con su `provider_message_id`;
 *   2. cuando llega el `failed`, se REINTENTA por plantilla (lo único que Meta
 *      entrega fuera de la ventana de 24h);
 *   3. si el reintento tampoco sale, se avisa POR CORREO — otro proveedor, que
 *      funciona justo cuando WhatsApp no.
 *
 * Todo es best-effort: registrar o recuperar un aviso nunca puede romper el
 * envío ni el webhook.
 */

const TABLA = 'avisos_equipo'

export type TipoAviso = 'retiro' | 'operativo'

/** Datos para volver a mandar el aviso por plantilla si el original no se entregó. */
export interface ReintentoPlantilla {
  plantilla: string
  vars: string[]
  /** Payloads de los quick-reply (solo plantillas con botones). */
  payloads?: string[]
}

export interface RegistrarAvisoInput {
  numero: string
  tipo: TipoAviso
  /** Texto legible: es lo que se reenvía por correo si WhatsApp no lo entrega. */
  cuerpo: string
  providerMessageId: string
  reintento?: ReintentoPlantilla
  esReintento?: boolean
}

/**
 * Deja constancia de un aviso enviado. `estado` arranca en 'enviado', que acá
 * significa "Meta lo aceptó y todavía no reportó una falla" — no "llegó".
 */
export async function registrarAvisoEquipo(a: RegistrarAvisoInput): Promise<void> {
  if (!a.providerMessageId) return
  try {
    const ahora = new Date().toISOString()
    await appendRow(TABLA, {
      id: String(await getNextId(TABLA)),
      numero: (a.numero || '').replace(/\D/g, ''),
      tipo: a.tipo,
      cuerpo: (a.cuerpo || '').slice(0, 1500),
      provider_message_id: a.providerMessageId,
      estado: 'enviado',
      error: '',
      reintento_json: a.reintento ? JSON.stringify(a.reintento) : '',
      es_reintento: a.esReintento ? 'TRUE' : 'FALSE',
      fecha_creacion: ahora,
      fecha_estado: ahora,
    })
  } catch (e) {
    console.warn('[avisos-equipo] no se pudo registrar el aviso:', e)
  }
}

/**
 * Lo llama el webhook cuando Meta reporta que un mensaje FALLÓ. Si el id es de
 * un aviso al equipo, intenta recuperarlo; si es de un cliente, no hace nada.
 *
 * Devuelve true si el mensaje era un aviso al equipo (para poder loguearlo).
 */
export async function manejarAvisoFallido(providerMessageId: string, error?: string): Promise<boolean> {
  let fila: Record<string, string> | undefined
  try {
    const rows = await getSheetData(TABLA)
    fila = rows.find(r => String(r.provider_message_id) === String(providerMessageId))
  } catch (e) {
    console.warn('[avisos-equipo] no se pudo leer el registro de avisos:', e)
    return false
  }
  if (!fila) return false

  const detalle = (error || '').slice(0, 300)
  // Guardado contra re-entregas del webhook: solo actúa el primero que lo marque.
  const gano = await updateByIdIf(TABLA, fila.id, { estado: 'enviado' },
    { estado: 'fallido', error: detalle, fecha_estado: new Date().toISOString() })
    .catch(() => false)
  if (!gano) return true

  console.error(`[avisos-equipo] ⚠ el aviso ${fila.id} (${fila.tipo}) a ${fila.numero} NO se entregó: ${detalle || 'sin detalle'}`)

  // Un reintento que falla no se reintenta de nuevo: se avisa por correo.
  if (String(fila.es_reintento || '').toUpperCase() === 'TRUE') {
    await avisarPorCorreo(fila, detalle)
    return true
  }

  const ok = await reintentarPorPlantilla(fila)
  if (!ok) await avisarPorCorreo(fila, detalle)
  return true
}

/**
 * Reintenta el aviso con una PLANTILLA, que es lo único que Meta entrega con la
 * ventana de 24h cerrada. Si el aviso traía datos de plantilla (el de retiro,
 * con sus botones ✅/❌) se usa esa; si no, la genérica `aviso_operativo`.
 */
async function reintentarPorPlantilla(fila: Record<string, string>): Promise<boolean> {
  try {
    const { enviarPlantillaWhatsapp, enviarPlantillaBotonesWhatsapp } = await import('./whatsapp')
    let plan: ReintentoPlantilla | null = null
    try {
      const raw = String(fila.reintento_json || '')
      if (raw) plan = JSON.parse(raw) as ReintentoPlantilla
    } catch { /* JSON dañado → cae a la plantilla genérica */ }

    const env = plan?.plantilla
      ? (plan.payloads?.length
        ? await enviarPlantillaBotonesWhatsapp(fila.numero, plan.plantilla, plan.vars, plan.payloads)
        : await enviarPlantillaWhatsapp(fila.numero, plan.plantilla, plan.vars))
      : await enviarPlantillaWhatsapp(fila.numero, 'aviso_operativo', [String(fila.cuerpo || '').slice(0, 500)])

    if (!env.ok) {
      console.error(`[avisos-equipo] el reintento del aviso ${fila.id} tampoco salió: ${env.error}`)
      return false
    }
    // El reintento también se registra: si ESTE falla, el webhook manda el correo.
    await registrarAvisoEquipo({
      numero: fila.numero,
      tipo: (fila.tipo === 'retiro' ? 'retiro' : 'operativo'),
      cuerpo: fila.cuerpo || '',
      providerMessageId: env.message_id || '',
      reintento: plan ?? undefined,
      esReintento: true,
    })
    await updateByIdIf(TABLA, fila.id, {}, { estado: 'reintentado', fecha_estado: new Date().toISOString() })
      .catch(() => false)
    return true
  } catch (e) {
    console.error('[avisos-equipo] error reintentando el aviso:', e)
    return false
  }
}

/**
 * Último recurso: si WhatsApp no lo entregó, va por CORREO. Los destinatarios
 * son los de la casilla de seguimiento (Configuración → Correos → Ajustes) y,
 * si no hay ninguna, el correo del administrador.
 */
async function avisarPorCorreo(fila: Record<string, string>, detalle: string): Promise<void> {
  try {
    const [{ sendEmail, isResendConfigured }, { renderEmailLayout, getContacto, escapeHtml, BRAND }] = await Promise.all([
      import('./resend-mailer'), import('./email-layout'),
    ])
    if (!isResendConfigured()) return

    let destinos: string[] = []
    try {
      const rows = await getSheetData('empresa_config')
      const row = rows.find(r => r.id === '1') || rows[0]
      destinos = String(row?.email_seguimiento || '').split(/[,;\n]/).map(s => s.trim()).filter(Boolean)
    } catch { /* cae al admin */ }
    if (!destinos.length && process.env.ADMIN_EMAIL) destinos = [process.env.ADMIN_EMAIL]
    if (!destinos.length) {
      console.error('[avisos-equipo] no hay a quién avisarle por correo del aviso no entregado')
      return
    }

    const esRetiro = fila.tipo === 'retiro'
    const bodyHtml = `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;border-spacing:0;background:${BRAND.cream};border-left:4px solid ${BRAND.amber};border-radius:12px">
        <tr><td style="padding:20px">
          <div style="font-size:20px;font-weight:800;color:${BRAND.navy};margin-bottom:8px">Un aviso del sistema no llegó por WhatsApp</div>
          <p style="margin:0 0 12px;font-size:14px;color:#374151;line-height:1.5">
            Intentamos avisarle al equipo al <strong>+${escapeHtml(fila.numero)}</strong> y WhatsApp no lo entregó,
            ni siquiera al reintentar por plantilla. Te lo dejamos acá para que no se pierda.
          </p>
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px;font-size:14px;color:#111827;line-height:1.55;white-space:pre-wrap">${escapeHtml(fila.cuerpo || '(sin contenido)')}</div>
          ${esRetiro ? `<p style="margin:12px 0 0;font-size:13px;color:#374151">Resuélvelo desde el panel del dashboard: la solicitud está esperando confirmación.</p>` : ''}
          ${detalle ? `<p style="margin:12px 0 0;font-size:12px;color:#6b7280">Motivo que reportó Meta: ${escapeHtml(detalle)}</p>` : ''}
          <p style="margin:10px 0 0;font-size:12px;color:#6b7280">
            Si esto se repite, revisa el estado de la cuenta de WhatsApp: lo más común es un problema con el método de pago,
            que bloquea justamente los mensajes que inicia el negocio.
          </p>
        </td></tr>
      </table>`

    await sendEmail({
      to: destinos.join(', '),
      subject: esRetiro
        ? '⚠️ No se pudo avisar por WhatsApp una solicitud de retiro'
        : '⚠️ Un aviso del sistema no se entregó por WhatsApp',
      html: renderEmailLayout({
        titulo: 'Aviso no entregado',
        contexto: 'Alerta del sistema',
        bodyHtml,
        contacto: await getContacto(),
      }),
      tags: [{ name: 'tipo', value: 'aviso_no_entregado' }],
    })
  } catch (e) {
    console.error('[avisos-equipo] no se pudo avisar por correo:', e)
  }
}

/** Avisos que no se pudieron entregar (para mostrarlos donde corresponda). */
export async function avisosSinEntregar(desdeISO?: string): Promise<Record<string, string>[]> {
  try {
    const rows = await getSheetData(TABLA)
    return rows.filter(r =>
      ['fallido', 'sin_entregar'].includes(String(r.estado || '')) &&
      (!desdeISO || String(r.fecha_creacion || '') >= desdeISO))
  } catch {
    return []
  }
}

/** Fecha de Chile de hoy — para acotar consultas del día. */
export function hoyChile(): string {
  return fechaChileISO()
}
