import { sendEmail, sendBatch, isResendConfigured, type SendOpts } from './resend-mailer'
import { renderEmailLayout, getContacto, escapeHtml, BRAND, type Contacto } from './email-layout'
import { registrarEnvio, registrarEnvios, type TipoCorreo } from './correos-log'
import { createTutorToken } from './tutor-token'

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
  /** Código del servicio (CI/CP/SD). Si es CP (Premium), el correo pide también la
   *  foto para el cuadro acuarela conmemorativo. */
  codigoServicio?: string
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
  // Links firmados (HMAC) por ficha + acción, válidos 24 horas — reemplazan el
  // "código" adivinable: solo quien recibió este correo puede subir la foto de
  // ESTA mascota o solicitar su video. Sin clienteId no se pueden firmar, así que
  // omitimos el bloque.
  const base = (process.env.PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '').replace(/\/+$/, '')
  const cid = args.clienteId ? String(args.clienteId) : ''
  // Premium (CP) incluye un cuadro acuarela conmemorativo → pedimos además una foto
  // para el retrato (se guarda aparte, en clientes.fotos_cuadro).
  const esPremium = (args.codigoServicio || '').toUpperCase() === 'CP'
  const linkFoto = (base && cid) ? `${base}/subir-foto?token=${encodeURIComponent(createTutorToken(cid, 'subir_foto'))}` : ''
  const linkVideo = (base && cid) ? `${base}/solicitar-video?token=${encodeURIComponent(createTutorToken(cid, 'solicitar_video'))}` : ''
  const linkCuadro = (base && cid && esPremium) ? `${base}/subir-foto?token=${encodeURIComponent(createTutorToken(cid, 'subir_foto_cuadro'))}&tipo=cuadro` : ''
  const btnCuadro = linkCuadro ? `
        <div style="text-align:center;margin-top:10px">
          <a href="${linkCuadro}" style="display:inline-block;background:${BRAND.amber};color:${BRAND.navy};text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:10px">
            🖼️ Foto para el cuadro
          </a>
        </div>` : ''
  const introFoto = esPremium
    ? `Como elegiste el servicio Premium, puedes subir la foto para el <strong>cuadro conmemorativo</strong> de ${mascota}, sumar una foto a su certificado y solicitar el video de su proceso:`
    : `Puedes sumar una foto al certificado de ${mascota} y solicitar el video de su proceso:`
  const bloqueFoto = (linkFoto && linkVideo) ? `
      <div style="background:${BRAND.cream};border:1px solid ${BRAND.hairline};border-radius:12px;padding:20px;margin:20px 0">
        <p style="margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:1.2px;font-weight:700;color:${BRAND.navy};text-align:center">Dentro de las próximas 24 horas</p>
        <p style="margin:0 0 16px;font-size:13px;color:${BRAND.muted};text-align:center;line-height:1.5">
          ${introFoto}
        </p>
        <div style="text-align:center">
          <a href="${linkFoto}" style="display:inline-block;background:${BRAND.amber};color:${BRAND.navy};text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:10px">
            📷 Foto para el certificado
          </a>
        </div>${btnCuadro}
        <div style="text-align:center;margin-top:10px">
          <a href="${linkVideo}" style="display:inline-block;background:${BRAND.navy};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:10px">
            🎥 Quiero el video del proceso
          </a>
        </div>
        <p style="margin:14px 0 0;font-size:12px;color:${BRAND.muted};text-align:center">Estos enlaces vencen en 24 horas.</p>
      </div>` : ''
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
      ${bloqueFoto}
      <p style="margin:18px 0 0;padding-top:14px;border-top:1px solid ${BRAND.hairline};font-size:12px;line-height:1.6;color:${BRAND.muted}">
        <strong>Sobre el peso:</strong> al recibir a ${mascota} verificamos su peso en balanza. Si resultara mayor al
        declarado, el valor se ajusta al tramo que corresponda — te avisaríamos con el detalle y el respaldo, para que
        no haya sorpresas.
      </p>`
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
  /** Si es true, el correo de entrega NO incluye el pedido de evaluación
   *  (clientes marcados como "no pedir evaluación"). */
  sinEvaluacion?: boolean
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
  const reseña = (contacto.googleReviewUrl && !args.sinEvaluacion)
    ? `
      <div style="margin:28px 0 6px;padding:30px 24px;background:${BRAND.navy};border-radius:16px;text-align:center">
        <div style="font-size:30px;line-height:1;letter-spacing:4px;margin-bottom:14px">⭐⭐⭐⭐⭐</div>
        <p style="margin:0 0 12px;font-size:21px;font-weight:700;color:#ffffff;line-height:1.3">
          Para cerrar el proceso, ¿nos dejas tu evaluación?
        </p>
        <p style="margin:0 auto 22px;max-width:440px;font-size:15px;color:#e8eef5;line-height:1.65">
          Para nosotros es lo más valioso que podemos recibir. Contar tu experiencia ayuda a otras familias
          a elegir con confianza en uno de los momentos más difíciles, y a nosotros nos impulsa a seguir
          cuidando cada despedida como se merece.
        </p>
        <a href="${escapeHtml(contacto.googleReviewUrl)}" style="display:inline-block;background:${BRAND.amber};color:${BRAND.navy};text-decoration:none;font-weight:700;font-size:17px;padding:16px 40px;border-radius:12px">
          ⭐ Evalúanos aquí
        </a>
        <p style="margin:16px 0 0;font-size:13px;color:#aebfd4;line-height:1.5">
          Te toma menos de un minuto y para nosotros significa muchísimo.
        </p>
      </div>`
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

// ─── 6. Cobro por diferencia de peso (peso real > tramo declarado) ────────────

/** Un producto/servicio adicional cobrado. */
export interface CobroItem { nombre: string; precio: number; qty?: number }

/** Datos de la cuenta de transferencia (los vacíos se omiten del correo). */
export interface DatosTransferencia { titular: string; rut: string; banco: string; tipoCuenta: string; numeroCuenta: string; correo: string }

/** Fila de la tabla de datos de transferencia (vacía si el valor no está). */
function filaTransf(label: string, valor: string): string {
  return valor ? `
        <tr>
          <td style="padding:3px 12px 3px 0;font-size:13px;color:${BRAND.muted};white-space:nowrap">${label}</td>
          <td style="padding:3px 0;font-size:13px;font-weight:600;color:${BRAND.ink}">${escapeHtml(valor)}</td>
        </tr>` : ''
}
function tablaTransferencia(t: DatosTransferencia): string {
  return `<div style="border:1px solid ${BRAND.hairline};border-radius:12px;padding:14px 18px;margin:0 0 16px">
        <table style="border-collapse:collapse">${filaTransf('Titular', t.titular)}${filaTransf('RUT', t.rut)}${filaTransf('Banco', t.banco)}${filaTransf('Tipo de cuenta', t.tipoCuenta)}${filaTransf('N° de cuenta', t.numeroCuenta)}${filaTransf('Correo', t.correo)}</table>
      </div>`
}
/** Botón "Confirma tu transferencia aquí" (bulletproof-ish para email). */
function botonConfirmaTransferencia(link: string): string {
  if (!link) return ''
  return `<div style="text-align:center;margin:6px 0 18px">
        <a href="${link}" style="display:inline-block;background:${BRAND.navy};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 28px;border-radius:10px">
          ✅ Confirma tu transferencia aquí
        </a>
        <p style="margin:8px 0 0;font-size:11px;color:${BRAND.muted}">Aprieta el botón una vez que hayas transferido, así lo dejamos registrado.</p>
      </div>`
}

export interface CobroDiferenciaArgs {
  email: string
  nombreMascota: string
  nombreTutor: string
  clienteId?: string
  pesoDeclarado: number
  pesoIngreso: number
  /** Diferencia a pagar (CLP), calculada server-side con la tabla del cliente. */
  monto: number
  /** Datos de transferencia (empresa_config). Los vacíos se omiten. */
  transferencia: DatosTransferencia
  /** Link firmado para el botón "confirma tu transferencia" (opcional). */
  linkConfirma?: string
}

/**
 * Arma el correo que solicita el pago de la diferencia por peso real mayor al
 * declarado. La FOTO de evidencia la adjunta la ruta que lo envía
 * (/api/clientes/[id]/cobro-diferencia); acá solo va el cuerpo.
 */
export function buildCobroDiferencia(args: CobroDiferenciaArgs, contacto: Contacto): SendOpts {
  const mascota = escapeHtml(args.nombreMascota)
  const fmt = (n: number) => '$' + Math.round(n).toLocaleString('es-CL')
  const cuerpo = `
      <p style="margin:0 0 14px;font-size:15px">${saludo(args.nombreTutor)}</p>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.6">
        Al recibir a <strong>${mascota}</strong> registramos su peso real en nuestra balanza:
        <strong>${args.pesoIngreso} kg</strong>, mayor al peso declarado al agendar el servicio
        (${args.pesoDeclarado} kg). Con esto, el servicio corresponde a un tramo superior de la tarifa.
      </p>
      <div style="background:${BRAND.cream};border:1px solid ${BRAND.hairline};border-radius:12px;padding:18px;margin:18px 0;text-align:center">
        <p style="margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:1.2px;font-weight:700;color:${BRAND.navy}">Diferencia a pagar</p>
        <p style="margin:0;font-size:24px;font-weight:700;color:${BRAND.navy}">${fmt(args.monto)}</p>
      </div>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.6">
        Adjuntamos una <strong>fotografía del pesaje</strong> como respaldo. Puedes pagar la diferencia
        por transferencia a la siguiente cuenta:
      </p>
      ${tablaTransferencia(args.transferencia)}
      ${botonConfirmaTransferencia(args.linkConfirma || '')}
      <p style="margin:0;font-size:14px;line-height:1.6">
        Cualquier duda sobre el pesaje o el cobro, escríbenos — estamos para ayudarte. 🐾
      </p>`
  return {
    to: args.email,
    subject: `Diferencia de peso en el ingreso de ${args.nombreMascota}`,
    html: renderEmailLayout({ titulo: `Cobro adicional por diferencia de peso`, bodyHtml: cuerpo, contacto }),
    preview_text: `El peso real de ${args.nombreMascota} corresponde a un tramo superior — diferencia a pagar.`,
    tags: [{ name: 'tipo', value: 'cliente_cobro_diferencia' }],
    seguimiento: { tipo: 'cliente_cobro_diferencia', audiencia: 'Tutor', nombre: args.nombreMascota, clienteId: args.clienteId },
  }
}

// ─── 7. Cobro por productos adicionales agregados al servicio ─────────────────

export interface CobroAdicionalArgs {
  email: string
  nombreMascota: string
  nombreTutor: string
  clienteId?: string
  /** Productos/servicios agregados. */
  items: CobroItem[]
  /** Total a pagar (CLP). */
  monto: number
  transferencia: DatosTransferencia
  /** Link firmado para el botón "confirma tu transferencia". */
  linkConfirma?: string
}

/**
 * Correo "según lo solicitado" cuando se agrega uno o más productos adicionales
 * al servicio: detalle de lo agregado + datos de transferencia + botón para
 * confirmar el pago. Lo dispara lib/cobros.ts (alta manual en la ficha o el bot).
 */
export function buildCobroAdicional(args: CobroAdicionalArgs, contacto: Contacto): SendOpts {
  const mascota = escapeHtml(args.nombreMascota)
  const fmt = (n: number) => '$' + Math.round(n).toLocaleString('es-CL')
  const filas = args.items.map(i => `
        <tr>
          <td style="padding:6px 0;font-size:14px;color:${BRAND.ink}">${i.qty && i.qty > 1 ? `${i.qty}× ` : ''}${escapeHtml(i.nombre)}</td>
          <td style="padding:6px 0;font-size:14px;font-weight:600;color:${BRAND.ink};text-align:right;white-space:nowrap">${fmt((i.precio || 0) * (i.qty || 1))}</td>
        </tr>`).join('')
  const cuerpo = `
      <p style="margin:0 0 14px;font-size:15px">${saludo(args.nombreTutor)}</p>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.6">
        Según lo solicitado, agregamos al servicio de <strong>${mascota}</strong> el siguiente detalle:
      </p>
      <div style="border:1px solid ${BRAND.hairline};border-radius:12px;padding:12px 18px;margin:0 0 16px">
        <table style="width:100%;border-collapse:collapse">${filas}
          <tr><td colspan="2" style="border-top:1px solid ${BRAND.hairline};padding-top:8px"></td></tr>
          <tr>
            <td style="padding:2px 0;font-size:14px;font-weight:700;color:${BRAND.navy}">Total a pagar</td>
            <td style="padding:2px 0;font-size:16px;font-weight:700;color:${BRAND.navy};text-align:right">${fmt(args.monto)}</td>
          </tr>
        </table>
      </div>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.6">
        Puedes pagarlo por transferencia a la siguiente cuenta:
      </p>
      ${tablaTransferencia(args.transferencia)}
      ${botonConfirmaTransferencia(args.linkConfirma || '')}
      <p style="margin:0;font-size:14px;line-height:1.6">
        Cualquier duda, escríbenos — estamos para ayudarte. 🐾
      </p>`
  return {
    to: args.email,
    subject: `Detalle de lo agregado al servicio de ${args.nombreMascota}`,
    html: renderEmailLayout({ titulo: 'Detalle de productos adicionales', bodyHtml: cuerpo, contacto }),
    preview_text: `Según lo solicitado, agregamos ${args.items.map(i => i.nombre).join(', ')} al servicio de ${args.nombreMascota}.`,
    tags: [{ name: 'tipo', value: 'cliente_cobro_adicional' }],
    seguimiento: { tipo: 'cliente_cobro_adicional', audiencia: 'Tutor', nombre: args.nombreMascota, clienteId: args.clienteId },
  }
}

// ─── 8. Envío de la boleta emitida (PDF adjunto) ──────────────────────────────

export interface BoletaArgs {
  email: string
  nombreMascota: string
  nombreTutor: string
  clienteId?: string
  /** Folio del DTE emitido por el SII. */
  folio: string
  /** Monto total (CLP), IVA incluido. */
  montoTotal: number
  /** URL pública del PDF en R2 (Resend lo descarga desde ahí). */
  pdfUrl: string
}

/**
 * Envía al tutor la boleta (PDF) recién emitida, al correo registrado en la
 * ficha. La dispara emitirBoletaFicha (lib/facturacion.ts) apenas se emite —
 * automática al confirmar el pago. Best-effort: nunca rompe la emisión.
 */
export async function enviarBoletaCliente(args: BoletaArgs): Promise<void> {
  if (!args.email) return
  if (!isResendConfigured()) {
    console.warn('[cliente-mailer] Resend no configurado, salto mail boleta a', args.email)
    return
  }
  const contacto = await getContacto()
  try {
    const res = await sendEmail(buildBoleta(args, contacto))
    if (res.ok) console.log(`[cliente-mailer] OK boleta a ${args.email}, message_id=${res.message_id}`)
    else console.error(`[cliente-mailer] FAIL boleta a ${args.email}: ${res.error}`)
    await registrarEnvio({ clienteId: args.clienteId, tipo: 'boleta', email: args.email, messageId: res.message_id, ok: res.ok, error: res.error })
  } catch (e) {
    console.error(`[cliente-mailer] EXC boleta a ${args.email}:`, e instanceof Error ? e.message : String(e))
    await registrarEnvio({ clienteId: args.clienteId, tipo: 'boleta', email: args.email, ok: false, error: e instanceof Error ? e.message : String(e) })
  }
}

/** Arma el correo con la boleta (PDF) adjunta. */
export function buildBoleta(args: BoletaArgs, contacto: Contacto): SendOpts {
  const mascota = escapeHtml(args.nombreMascota)
  const fmt = (n: number) => '$' + Math.round(n).toLocaleString('es-CL')
  const cuerpo = `
      <p style="margin:0 0 14px;font-size:15px">${saludo(args.nombreTutor)}</p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6">
        Adjuntamos la boleta correspondiente al servicio de <strong>${mascota}</strong>.
      </p>
      <div style="background:${BRAND.cream};border:1px solid ${BRAND.hairline};border-radius:12px;padding:18px;margin:18px 0;text-align:center">
        <p style="margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:1.2px;font-weight:700;color:${BRAND.navy}">Boleta N° ${escapeHtml(args.folio)}</p>
        <p style="margin:0;font-size:24px;font-weight:700;color:${BRAND.navy}">${fmt(args.montoTotal)}</p>
      </div>
      <p style="margin:0;font-size:14px;line-height:1.6">
        Cualquier duda sobre este documento, escríbenos — estamos para ayudarte. 🐾
      </p>`
  return {
    to: args.email,
    subject: `Tu boleta — ${args.nombreMascota}`,
    html: renderEmailLayout({ titulo: `Boleta del servicio de ${args.nombreMascota}`, bodyHtml: cuerpo, contacto }),
    preview_text: `Adjuntamos la boleta N° ${args.folio} del servicio de ${args.nombreMascota}.`,
    tags: [{ name: 'tipo', value: 'cliente_boleta' }],
    attachments: args.pdfUrl ? [{ filename: `Boleta-${args.folio || 'AlmaAnimal'}.pdf`, path: args.pdfUrl, content_type: 'application/pdf' }] : undefined,
    seguimiento: { tipo: 'cliente_boleta', audiencia: 'Tutor', nombre: args.nombreMascota, clienteId: args.clienteId },
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
