import { sendEmail, sendBatch, isResendConfigured, type SendOpts } from './resend-mailer'
import { renderEmailLayout, getContacto, escapeHtml, BRAND, type Contacto } from './email-layout'

/**
 * Correos transaccionales al tutor (dueño de la mascota), enganchados en los
 * tres hitos del proceso:
 *
 *  1. Registro de la ficha + generación del código → enviarRegistroMascota
 *  2. Inicio del ciclo de cremación               → enviarInicioCremacion
 *  3. Confirmación de la ruta de despacho          → enviarInicioDespacho
 *
 * Convención del proyecto: SIEMPRE nos referimos a la mascota por su nombre,
 * nunca como "su mascota" o "la mascota". El nombre va en el asunto y en el
 * cuerpo. Texto en español neutro. La estructura visual (header/footer) es la
 * compartida en lib/email-layout.ts.
 *
 * Todos los envíos son best-effort: si Resend no está configurado o el envío
 * falla, lo loggeamos pero NO rompemos la operación principal (crear ficha,
 * ciclo o despacho). Mismo criterio que lib/eutanasia-mailer.ts.
 */

/** Tutor + mascota destinatarios de un envío. */
export interface DestinatarioTutor {
  email: string
  nombreMascota: string
  nombreTutor: string
}

/** Saludo seguro: "Hola Nombre," o "Hola," si no hay nombre de tutor. */
function saludo(nombreTutor: string): string {
  const n = (nombreTutor || '').trim()
  return n ? `Hola <strong>${escapeHtml(n)}</strong>,` : 'Hola,'
}

// ─── 1. Registro de la mascota + código ──────────────────────────────────────

export interface RegistroArgs {
  email: string
  nombreMascota: string
  nombreTutor: string
  codigo: string
}

/**
 * Mail de bienvenida al tutor cuando se registra la ficha y se genera el
 * código de la mascota. Best-effort.
 */
export async function enviarRegistroMascota(args: RegistroArgs): Promise<void> {
  if (!args.email) return
  if (!isResendConfigured()) {
    console.warn('[cliente-mailer] Resend no configurado, salto mail registro a', args.email)
    return
  }
  const contacto = await getContacto()
  const mascota = escapeHtml(args.nombreMascota)
  const cuerpo = `
      <p style="margin:0 0 14px;font-size:15px">${saludo(args.nombreTutor)}</p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6">
        Gracias por preferirnos y por confiar en nosotros para acompañarte en este momento.
        Es un honor poder cuidar de <strong>${mascota}</strong>.
      </p>
      <div style="background:${BRAND.cream};border:1px solid ${BRAND.hairline};border-radius:12px;padding:20px;margin:18px 0;text-align:center">
        <p style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;color:${BRAND.muted}">Código asociado a ${mascota}</p>
        <p style="margin:0;font-size:28px;font-weight:700;letter-spacing:1px;color:${BRAND.navy}">${escapeHtml(args.codigo)}</p>
      </div>
      <p style="margin:0;font-size:14px;line-height:1.6">
        Guarda este código: nos permite identificar a ${mascota} durante todo el proceso.
      </p>`
  try {
    const res = await sendEmail({
      to: args.email,
      subject: `Gracias por confiar en nosotros — ${args.nombreMascota}`,
      html: renderEmailLayout({ titulo: '¡Gracias por confiar en nosotros!', bodyHtml: cuerpo, contacto }),
      preview_text: `Te dejamos el código asociado a ${args.nombreMascota}.`,
      tags: [{ name: 'tipo', value: 'cliente_registro' }],
    })
    if (res.ok) console.log(`[cliente-mailer] OK registro a ${args.email}, message_id=${res.message_id}`)
    else console.error(`[cliente-mailer] FAIL registro a ${args.email}: ${res.error}`)
  } catch (e) {
    console.error(`[cliente-mailer] EXC registro a ${args.email}:`, e instanceof Error ? e.message : String(e))
  }
}

// ─── 2. Inicio del proceso de cremación (a todos los tutores del ciclo) ───────

/**
 * Avisa a cada tutor del ciclo que se inició la cremación de SU mascota
 * (cada correo personalizado con el nombre de la mascota). Best-effort, en
 * lotes de 100 (límite de Resend).
 */
export async function enviarInicioCremacion(destinatarios: DestinatarioTutor[]): Promise<void> {
  const validos = destinatarios.filter(d => d.email)
  if (validos.length === 0) return
  if (!isResendConfigured()) {
    console.warn('[cliente-mailer] Resend no configurado, salto mails inicio cremación')
    return
  }
  const contacto = await getContacto()
  const emails: SendOpts[] = validos.map(d => buildCremacion(d, contacto))
  await enviarEnLotes(emails, 'inicio cremación')
}

function buildCremacion(d: DestinatarioTutor, contacto: Contacto): SendOpts {
  const mascota = escapeHtml(d.nombreMascota)
  const cuerpo = `
      <p style="margin:0 0 14px;font-size:15px">${saludo(d.nombreTutor)}</p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6">
        Te informamos que hemos iniciado el proceso de cremación de <strong>${mascota}</strong>.
        Lo realizamos con el mayor respeto y cuidado que merece.
      </p>
      <p style="margin:0;font-size:14px;line-height:1.6">
        Te avisaremos nuevamente cuando ${mascota} esté en camino de regreso a tu hogar.
      </p>`
  return {
    to: d.email,
    subject: `Hemos iniciado el proceso de cremación de ${d.nombreMascota}`,
    html: renderEmailLayout({ titulo: 'Iniciamos el proceso de cremación', bodyHtml: cuerpo, contacto }),
    preview_text: `El proceso de cremación de ${d.nombreMascota} ha comenzado.`,
    tags: [{ name: 'tipo', value: 'cliente_inicio_cremacion' }],
  }
}

// ─── 3. Inicio de la ruta de despacho (a todos los tutores de la ruta) ────────

/**
 * Avisa a cada tutor de la ruta que el ánfora de SU mascota va en camino.
 * Best-effort, en lotes de 100.
 */
export async function enviarInicioDespacho(destinatarios: DestinatarioTutor[]): Promise<void> {
  const validos = destinatarios.filter(d => d.email)
  if (validos.length === 0) return
  if (!isResendConfigured()) {
    console.warn('[cliente-mailer] Resend no configurado, salto mails inicio despacho')
    return
  }
  const contacto = await getContacto()
  const emails: SendOpts[] = validos.map(d => buildDespacho(d, contacto))
  await enviarEnLotes(emails, 'inicio despacho')
}

function buildDespacho(d: DestinatarioTutor, contacto: Contacto): SendOpts {
  const mascota = escapeHtml(d.nombreMascota)
  const cuerpo = `
      <p style="margin:0 0 14px;font-size:15px">${saludo(d.nombreTutor)}</p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6">
        Hemos iniciado la ruta de entregas, por lo que dentro de las próximas horas estarás
        recibiendo el ánfora de <strong>${mascota}</strong> en tu hogar.
      </p>
      <p style="margin:0;font-size:14px;line-height:1.6">
        Te pedimos estar atento/a durante el día. Gracias por confiar en nosotros para
        acompañar a ${mascota}.
      </p>`
  return {
    to: d.email,
    subject: `Vamos en camino con ${d.nombreMascota}`,
    html: renderEmailLayout({ titulo: 'Tu ánfora va en camino', bodyHtml: cuerpo, contacto }),
    preview_text: `Dentro de las próximas horas recibirás el ánfora de ${d.nombreMascota}.`,
    tags: [{ name: 'tipo', value: 'cliente_inicio_despacho' }],
  }
}

// ─── 4. Entrega confirmada + reseña (al marcar una mascota como entregada) ────

export interface EntregaArgs {
  email: string
  nombreMascota: string
  nombreTutor: string
  /** Código de la mascota; se muestra entre paréntesis junto al nombre. */
  codigo?: string
}

/**
 * Mail al tutor cuando el ánfora de su mascota fue entregada en la ruta de
 * despacho. Confirma la entrega, agradece y ofrece dejar una reseña en Google
 * (si hay google_review_url configurado en empresa_config). Best-effort.
 */
export async function enviarEntregaConfirmada(args: EntregaArgs): Promise<void> {
  if (!args.email) return
  if (!isResendConfigured()) {
    console.warn('[cliente-mailer] Resend no configurado, salto mail entrega a', args.email)
    return
  }
  const contacto = await getContacto()
  const mascota = escapeHtml(args.nombreMascota)
  // Nombre con el código entre paréntesis, ej. "Molly (G79-CI)".
  const mascotaCodigo = args.codigo ? `${mascota} (${escapeHtml(args.codigo)})` : mascota
  const reseña = contacto.googleReviewUrl
    ? `
      <div style="text-align:center;margin:22px 0 6px">
        <a href="${escapeHtml(contacto.googleReviewUrl)}" style="display:inline-block;background:${BRAND.amber};color:${BRAND.navy};text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:10px">
          ⭐ Evalúanos aquí
        </a>
      </div>
      <p style="margin:8px 0 0;font-size:13px;color:${BRAND.muted};text-align:center;line-height:1.5">
        Tu opinión nos ayuda muchísimo y le sirve a otras familias que nos buscan en un momento difícil.
      </p>`
    : ''
  const cuerpo = `
      <p style="margin:0 0 14px;font-size:15px">${saludo(args.nombreTutor)}</p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6">
        Te confirmamos que el ánfora de <strong>${mascotaCodigo}</strong> fue entregada. Fue un honor
        acompañarte y cuidar de ${mascota} en todo el proceso.
      </p>
      <p style="margin:0 0 4px;font-size:14px;line-height:1.6">
        Gracias por confiar en nosotros y por preferirnos.
      </p>
      ${reseña}`
  try {
    const res = await sendEmail({
      to: args.email,
      subject: `Hemos entregado a ${args.nombreMascota} — gracias por confiar en nosotros`,
      html: renderEmailLayout({ titulo: `Entrega confirmada de ${args.codigo ? `${args.nombreMascota} (${args.codigo})` : args.nombreMascota}`, bodyHtml: cuerpo, contacto }),
      preview_text: `El ánfora de ${args.nombreMascota} fue entregada. ¡Gracias!`,
      tags: [{ name: 'tipo', value: 'cliente_entrega' }],
    })
    if (res.ok) console.log(`[cliente-mailer] OK entrega a ${args.email}, message_id=${res.message_id}`)
    else console.error(`[cliente-mailer] FAIL entrega a ${args.email}: ${res.error}`)
  } catch (e) {
    console.error(`[cliente-mailer] EXC entrega a ${args.email}:`, e instanceof Error ? e.message : String(e))
  }
}

/** Envía en lotes de 100 (límite de sendBatch). Loggea un resumen por lote. */
async function enviarEnLotes(emails: SendOpts[], etiqueta: string): Promise<void> {
  for (let i = 0; i < emails.length; i += 100) {
    const chunk = emails.slice(i, i + 100)
    try {
      const res = await sendBatch(chunk)
      const ok = res.filter(r => r.ok).length
      console.log(`[cliente-mailer] ${etiqueta}: lote ${i / 100 + 1} → ${ok}/${chunk.length} enviados`)
    } catch (e) {
      console.error(`[cliente-mailer] ${etiqueta}: lote ${i / 100 + 1} falló:`, e instanceof Error ? e.message : String(e))
    }
  }
}
