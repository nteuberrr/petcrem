import { sendEmail, sendBatch, isResendConfigured, type SendOpts } from './resend-mailer'
import { renderEmailLayout, getContacto, escapeHtml, BRAND, type Contacto } from './email-layout'
import { registrarEnvio, registrarEnvios, type TipoCorreo } from './correos-log'
import { createFotoToken } from './foto-token'

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
  /** Id de la ficha del cliente, para registrar el correo en su historial. */
  clienteId?: string
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
  clienteId?: string
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
  try {
    const res = await sendEmail(buildRegistro(args, contacto))
    if (res.ok) console.log(`[cliente-mailer] OK registro a ${args.email}, message_id=${res.message_id}`)
    else console.error(`[cliente-mailer] FAIL registro a ${args.email}: ${res.error}`)
    await registrarEnvio({ clienteId: args.clienteId, tipo: 'registro', email: args.email, messageId: res.message_id, ok: res.ok, error: res.error })
  } catch (e) {
    console.error(`[cliente-mailer] EXC registro a ${args.email}:`, e instanceof Error ? e.message : String(e))
    await registrarEnvio({ clienteId: args.clienteId, tipo: 'registro', email: args.email, ok: false, error: e instanceof Error ? e.message : String(e) })
  }
}

/** Arma el correo de registro (código + botón para subir foto). */
export function buildRegistro(args: RegistroArgs, contacto: Contacto): SendOpts {
  const mascota = escapeHtml(args.nombreMascota)
  // Link al landing público para subir una foto de la mascota (se incluye en el
  // certificado de cremación). Si no hay base URL configurada, omitimos el botón.
  const base = (process.env.PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '').replace(/\/+$/, '')
  // Link firmado (HMAC) por ficha — reemplaza el "código" adivinable: solo quien
  // recibió este correo puede subir la foto de ESTA mascota. Sin clienteId no se
  // puede firmar el token, así que omitimos el botón.
  const linkFoto = (base && args.clienteId)
    ? `${base}/subir-foto?token=${encodeURIComponent(createFotoToken(String(args.clienteId)))}`
    : ''
  const bloqueFoto = linkFoto ? `
      <div style="text-align:center;margin:22px 0 6px">
        <a href="${linkFoto}" style="display:inline-block;background:${BRAND.amber};color:${BRAND.navy};text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:10px">
          📷 Sube una foto de ${mascota}
        </a>
      </div>
      <p style="margin:8px 0 0;font-size:13px;color:${BRAND.muted};text-align:center;line-height:1.5">
        Si quieres, sube una foto de ${mascota} y la incluiremos en su certificado de cremación.
      </p>` : ''
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
      </p>
      ${bloqueFoto}`
  return {
    to: args.email,
    subject: `Gracias por confiar en nosotros — ${args.nombreMascota}`,
    html: renderEmailLayout({ titulo: '¡Gracias por confiar en nosotros!', bodyHtml: cuerpo, contacto }),
    preview_text: `Te dejamos el código asociado a ${args.nombreMascota}.`,
    tags: [{ name: 'tipo', value: 'cliente_registro' }],
    seguimiento: { tipo: 'cliente_registro', audiencia: 'Tutor', nombre: args.nombreMascota, codigo: args.codigo, clienteId: args.clienteId },
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
  await enviarLoteTutor(validos.map(d => ({ d, opts: buildCremacion(d, contacto) })), 'inicio_cremacion', 'inicio cremación')
}

export function buildCremacion(d: DestinatarioTutor, contacto: Contacto): SendOpts {
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
    bccSeguimiento: true, // va en lote; opt-in para que el seguimiento lo copie
    seguimiento: { tipo: 'cliente_inicio_cremacion', audiencia: 'Tutor', nombre: d.nombreMascota, clienteId: d.clienteId },
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
  await enviarLoteTutor(validos.map(d => ({ d, opts: buildDespacho(d, contacto) })), 'inicio_despacho', 'inicio despacho')
}

export function buildDespacho(d: DestinatarioTutor, contacto: Contacto): SendOpts {
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
    bccSeguimiento: true, // va en lote; opt-in para que el seguimiento lo copie
    seguimiento: { tipo: 'cliente_inicio_despacho', audiencia: 'Tutor', nombre: d.nombreMascota, clienteId: d.clienteId },
  }
}

// ─── 4. Entrega confirmada + reseña (al marcar una mascota como entregada) ────

export interface EntregaArgs {
  email: string
  nombreMascota: string
  nombreTutor: string
  /** Código de la mascota; se muestra entre paréntesis junto al nombre. */
  codigo?: string
  clienteId?: string
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
  try {
    const res = await sendEmail(buildEntrega(args, contacto))
    if (res.ok) console.log(`[cliente-mailer] OK entrega a ${args.email}, message_id=${res.message_id}`)
    else console.error(`[cliente-mailer] FAIL entrega a ${args.email}: ${res.error}`)
    await registrarEnvio({ clienteId: args.clienteId, tipo: 'entrega', email: args.email, messageId: res.message_id, ok: res.ok, error: res.error })
  } catch (e) {
    console.error(`[cliente-mailer] EXC entrega a ${args.email}:`, e instanceof Error ? e.message : String(e))
    await registrarEnvio({ clienteId: args.clienteId, tipo: 'entrega', email: args.email, ok: false, error: e instanceof Error ? e.message : String(e) })
  }
}

/** Arma el correo de entrega confirmada + botón de reseña (si está configurada). */
export function buildEntrega(args: EntregaArgs, contacto: Contacto): SendOpts {
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
  return {
    to: args.email,
    subject: `Hemos entregado a ${args.nombreMascota} — gracias por confiar en nosotros`,
    html: renderEmailLayout({ titulo: `Entrega confirmada de ${args.codigo ? `${args.nombreMascota} (${args.codigo})` : args.nombreMascota}`, bodyHtml: cuerpo, contacto }),
    preview_text: `El ánfora de ${args.nombreMascota} fue entregada. ¡Gracias!`,
    tags: [{ name: 'tipo', value: 'cliente_entrega' }],
    seguimiento: { tipo: 'cliente_entrega', audiencia: 'Tutor', nombre: args.nombreMascota, codigo: args.codigo, clienteId: args.clienteId },
  }
}

// ─── 5. Envío del certificado de cremación (con PDF y, opcional, video) ───────

export interface CertificadoEmailArgs {
  email: string
  nombreMascota: string
  nombreTutor: string
  /** Fecha de cremación ya formateada (DD/MM/YYYY). */
  fechaCremacion: string
  /** true si además se adjunta el video del servicio (cambia el texto). */
  conVideo: boolean
}

/**
 * Arma el correo con el que se envía el certificado de cremación. Los adjuntos
 * (PDF + video) los agrega la ruta que lo envía; acá solo va el cuerpo. La
 * ruta /api/clientes/[id]/certificado/enviar lo usa como única fuente del texto.
 */
export function buildCertificado(args: CertificadoEmailArgs, contacto: Contacto): SendOpts {
  const mascota = escapeHtml(args.nombreMascota)
  const adjuntos = args.conVideo
    ? `el <strong>Certificado de Cremación</strong> y un <strong>video del servicio</strong> de ${mascota}`
    : `el <strong>Certificado de Cremación</strong> de ${mascota}`
  const cuerpo = `
      <p style="margin:0 0 14px;font-size:15px">Estimado(a) ${args.nombreTutor ? `<strong>${escapeHtml(args.nombreTutor)}</strong>` : 'tutor(a)'},</p>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.6">
        Reciba nuestro más sentido pésame por la partida de <strong>${mascota}</strong>.
        Fue un privilegio para nuestro equipo acompañarles en este momento y brindar el servicio
        de cremación con el cuidado y respeto que ${mascota} merecía.
      </p>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.6">
        Adjunto a este correo encontrará ${adjuntos},
        correspondiente al servicio realizado el ${escapeHtml(args.fechaCremacion)}.${args.conVideo ? '' : ' Este documento queda registrado para sus archivos.'}
      </p>
      <p style="margin:0;font-size:14px;line-height:1.6">
        Si necesita una copia adicional o tiene cualquier consulta posterior, no dude en escribirnos.
      </p>`
  return {
    to: args.email,
    subject: `Certificado de cremación — ${args.nombreMascota}`,
    html: renderEmailLayout({ titulo: `Certificado de cremación de ${args.nombreMascota}`, bodyHtml: cuerpo, contacto }),
    preview_text: `Adjuntamos el certificado de cremación de ${args.nombreMascota}.`,
    tags: [{ name: 'tipo', value: 'cliente_certificado' }],
    seguimiento: { tipo: 'cliente_certificado', audiencia: 'Tutor', nombre: args.nombreMascota },
  }
}

/**
 * Envía en lotes de 100 (límite de sendBatch) y REGISTRA cada destinatario en
 * correos_cliente (con su message_id) para el historial de la ficha. Loggea un
 * resumen por lote. Best-effort.
 */
async function enviarLoteTutor(
  items: { d: DestinatarioTutor; opts: SendOpts }[],
  tipo: TipoCorreo,
  etiqueta: string,
): Promise<void> {
  for (let i = 0; i < items.length; i += 100) {
    const chunk = items.slice(i, i + 100)
    try {
      const res = await sendBatch(chunk.map(c => c.opts))
      const ok = res.filter(r => r.ok).length
      console.log(`[cliente-mailer] ${etiqueta}: lote ${i / 100 + 1} → ${ok}/${chunk.length} enviados`)
      await registrarEnvios(chunk.map((c, k) => ({
        clienteId: c.d.clienteId, tipo, email: c.d.email,
        messageId: res[k]?.message_id, ok: !!res[k]?.ok, error: res[k]?.error,
      })))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[cliente-mailer] ${etiqueta}: lote ${i / 100 + 1} falló:`, msg)
      await registrarEnvios(chunk.map(c => ({ clienteId: c.d.clienteId, tipo, email: c.d.email, ok: false, error: msg })))
    }
  }
}
