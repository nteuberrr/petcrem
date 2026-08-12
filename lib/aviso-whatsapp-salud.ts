import { renderEmailLayout, getContacto, escapeHtml, BRAND } from './email-layout'
import { formatDate, fechaChileISO } from './dates'
import { consultarSaludWhatsapp } from './whatsapp-salud'
import { avisosSinEntregar } from './avisos-equipo'
import type { AvisoRenderizado } from './aviso-pagos-pendientes'

/**
 * AVISO "WhatsApp: estado de la cuenta" — el vigía del canal.
 *
 * Con «omitir si está vacío» activado (lo normal) NO manda nada mientras todo
 * funcione: solo aparece en tu correo el día que WhatsApp deja de entregar.
 *
 * Existe por el incidente del 11-08-2026: la cuenta quedó bloqueada por un
 * problema con el método de pago y estuvo DÍAS así sin que nadie se enterara —
 * Meta acepta los envíos igual y solo falla lo que inicia el negocio, así que el
 * inbox se veía impecable mientras las solicitudes de retiro no le llegaban a
 * nadie. Este aviso mira exactamente eso, y de paso lista los avisos al equipo
 * que quedaron sin entregar.
 *
 * Va por CORREO a propósito: es otro proveedor, y funciona justo cuando el canal
 * que hay que reportar está caído.
 */

const TITULO = 'WhatsApp: estado de la cuenta'
const CONTEXTO = 'Vigilancia del canal'

export async function construirAvisoSaludWhatsapp(): Promise<AvisoRenderizado> {
  const [salud, sinEntregar, contacto] = await Promise.all([
    consultarSaludWhatsapp(),
    avisosSinEntregar(fechaChileISO().slice(0, 8) + '01'), // desde el 1 del mes en curso
    getContacto(),
  ])
  const hoy = formatDate(fechaChileISO())

  // La calidad del número: verde es lo normal, amarillo ya es una advertencia
  // (Meta la baja por feedback de los usuarios) y rojo estrangula los envíos.
  // UNKNOWN no es una alarma: es lo que devuelve mientras no hay volumen.
  const calidadMala = salud.calidad === 'YELLOW' || salud.calidad === 'RED'

  // Todo bien y sin avisos caídos → nada que reportar (con "omitir vacío" no sale).
  const vacio = salud.consultado && salud.puedeEnviar && !calidadMala && sinEntregar.length === 0
  if (vacio) {
    return {
      subject: `WhatsApp operativo — ${hoy}`,
      vacio: true,
      resumen: 'WhatsApp entrega con normalidad.',
      html: renderEmailLayout({
        titulo: TITULO, contexto: CONTEXTO, contacto,
        bodyHtml: `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;border-spacing:0;background:${BRAND.cream};border-left:4px solid #10b981;border-radius:12px">
            <tr><td style="padding:20px">
              <div style="font-size:20px;font-weight:800;color:${BRAND.navy};margin-bottom:4px">Todo operativo 🐾</div>
              <p style="margin:0;font-size:14px;color:#374151">La cuenta de WhatsApp puede enviar mensajes y ningún aviso al equipo quedó sin entregar.</p>
            </td></tr>
          </table>`,
      }),
    }
  }

  const bloques: string[] = []

  if (!salud.consultado) {
    bloques.push(`
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;border-spacing:0;background:#fff7ed;border-left:4px solid ${BRAND.amber};border-radius:12px;margin-bottom:16px">
        <tr><td style="padding:18px">
          <div style="font-size:17px;font-weight:800;color:${BRAND.navy};margin-bottom:6px">No se pudo consultar el estado</div>
          <p style="margin:0;font-size:13px;color:#374151">${escapeHtml(salud.error || 'Error desconocido')}</p>
          <p style="margin:8px 0 0;font-size:12px;color:#6b7280">Puede ser el token de WhatsApp vencido o un problema momentáneo de Meta. Si se repite mañana, hay que revisarlo.</p>
        </td></tr>
      </table>`)
  } else if (!salud.puedeEnviar) {
    const detalle = salud.bloqueos.map(b => `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#fff;border:1px solid #fecaca;border-radius:10px;margin-top:10px">
        <tr><td style="padding:14px">
          <div style="font-size:13px;font-weight:700;color:#b91c1c;margin-bottom:4px">${escapeHtml(b.entidad)}${b.codigo ? ` · error ${b.codigo}` : ''}</div>
          <div style="font-size:13px;color:#111827;line-height:1.5">${escapeHtml(b.descripcion)}</div>
          ${b.solucion ? `<div style="font-size:12px;color:#6b7280;margin-top:6px">Solución que indica Meta: ${escapeHtml(b.solucion)}</div>` : ''}
        </td></tr>
      </table>`).join('')

    bloques.push(`
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;border-spacing:0;background:#fef2f2;border-left:4px solid #dc2626;border-radius:12px;margin-bottom:16px">
        <tr><td style="padding:20px">
          <div style="font-size:20px;font-weight:800;color:#991b1b;margin-bottom:6px">WhatsApp NO está entregando</div>
          <p style="margin:0;font-size:14px;color:#374151;line-height:1.5">
            Meta bloqueó los mensajes que <strong>inicia el negocio</strong>: los avisos al equipo, las plantillas al tutor
            (retiro confirmado, ánfora en camino, certificado) y las invitaciones a la red de veterinarios.
            Las respuestas a clientes que escribieron recién siguen saliendo, así que el inbox se ve normal:
            <strong>el problema no se nota desde adentro</strong>.
          </p>
          ${detalle}
          <p style="margin:14px 0 0;font-size:13px;color:#374151">
            Casi siempre es el método de pago. Se arregla en
            <a href="https://business.facebook.com/billing_hub/payment_settings" style="color:${BRAND.navy};font-weight:700">Facturación de Meta</a>
            agregando una tarjeta nueva; el desbloqueo tarda unos minutos en propagarse.
          </p>
        </td></tr>
      </table>`)
  }

  if (calidadMala) {
    const rojo = salud.calidad === 'RED'
    bloques.push(`
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;border-spacing:0;background:${rojo ? '#fef2f2' : '#fff7ed'};border-left:4px solid ${rojo ? '#dc2626' : BRAND.amber};border-radius:12px;margin-bottom:16px">
        <tr><td style="padding:20px">
          <div style="font-size:18px;font-weight:800;color:${rojo ? '#991b1b' : BRAND.navy};margin-bottom:6px">
            Calidad del número en ${rojo ? 'ROJO' : 'AMARILLO'}
          </div>
          <p style="margin:0;font-size:14px;color:#374151;line-height:1.5">
            Meta bajó la calificación del número porque hay gente bloqueándonos o marcando nuestros mensajes
            como no deseados. ${rojo
              ? 'En rojo <strong>reduce el límite de clientes nuevos por día</strong> y, si se sostiene, suspende el número.'
              : 'Todavía no limita nada, pero es el paso previo al rojo.'}
          </p>
          <p style="margin:12px 0 0;font-size:13px;color:#374151">
            Casi siempre viene de escribirle a quien no lo pidió o de insistir de más: revisá las plantillas de
            marketing y el seguimiento automático antes de mandar nada nuevo.
            ${salud.limite ? `<br>Límite actual de conversaciones iniciadas: <strong>${escapeHtml(salud.limite)}</strong>.` : ''}
          </p>
        </td></tr>
      </table>`)
  }

  if (sinEntregar.length) {
    const filas = sinEntregar.slice(0, 20).map(a => `
      <tr>
        <td style="padding:8px 10px;font-size:12px;color:#6b7280;white-space:nowrap;border-top:1px solid #f3f4f6">+${escapeHtml(String(a.numero || ''))}</td>
        <td style="padding:8px 10px;font-size:12px;color:#111827;border-top:1px solid #f3f4f6">${escapeHtml(String(a.cuerpo || '').slice(0, 140))}</td>
      </tr>`).join('')
    bloques.push(`
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#fff;border:1px solid #e5e7eb;border-radius:12px">
        <tr><td style="padding:16px">
          <div style="font-size:16px;font-weight:800;color:${BRAND.navy};margin-bottom:2px">Avisos que no llegaron este mes (${sinEntregar.length})</div>
          <p style="margin:0 0 8px;font-size:12px;color:#6b7280">Se reintentaron por plantilla y aun así no se entregaron.</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse">${filas}</table>
        </td></tr>
      </table>`)
  }

  const resumen = !salud.consultado
    ? 'No se pudo consultar el estado de WhatsApp.'
    : !salud.puedeEnviar
      ? `WhatsApp bloqueado: ${salud.bloqueos.map(b => b.codigo || b.entidad).join(', ')}`
      : calidadMala
        ? `Calidad del número en ${salud.calidad}`
        : `${sinEntregar.length} aviso(s) sin entregar`

  return {
    subject: !salud.puedeEnviar
      ? `🔴 WhatsApp no está entregando — ${hoy}`
      : calidadMala
        ? `⚠️ Calidad del número de WhatsApp en ${salud.calidad} — ${hoy}`
        : `⚠️ Avisos sin entregar por WhatsApp — ${hoy}`,
    vacio: false,
    resumen,
    html: renderEmailLayout({ titulo: TITULO, contexto: CONTEXTO, contacto, bodyHtml: bloques.join('') }),
  }
}
