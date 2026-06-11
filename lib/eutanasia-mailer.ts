import { sendEmail, isResendConfigured, getFromAddress } from './resend-mailer'
import { agregarDiasHabiles } from './dias-habiles'
import { formatDate, formatHoraDia } from './dates'
import { fmtPrecio } from './format'
import { createVetToken } from './eutanasia-tokens'
import { renderEmailLayout, getContacto, escapeHtml, BRAND, type Contacto } from './email-layout'

const CONTEXTO = 'Convenio Eutanasias'

/**
 * Arma el nombre completo del vet evitando duplicar el apellido cuando el
 * usuario, al inscribirse, lo metió en ambos campos (caso real: el vet escribe
 * "Nicolás Teuber" en el campo "nombre" y "Teuber" en "apellido" → quedaba
 * "Nicolás Teuber Teuber" en los saludos).
 *
 * Comportamiento:
 * - Si nombre y apellido están vacíos → 'Dr/a.'
 * - Si nombre ya termina con apellido (case-insensitive) → solo nombre
 * - En otro caso → "nombre apellido"
 */
export function nombreCompletoVet(nombre: string | undefined, apellido: string | undefined): string {
  const n = (nombre || '').trim()
  const a = (apellido || '').trim()
  if (!n && !a) return 'Dr/a.'
  if (!a) return n
  if (!n) return a
  if (n.toLowerCase().endsWith(a.toLowerCase())) return n
  return `${n} ${a}`
}

export interface BienvenidaResult {
  ok: boolean
  /** 'enviado' si Resend aceptó; 'omitido_sin_resend' si no había key; 'error' si falló. */
  estado: 'enviado' | 'omitido_sin_resend' | 'error'
  message_id?: string
  error?: string
  /** Para diagnóstico: from address que se usó (incluye sender configurado). */
  from_used?: string
  /** Para diagnóstico: dirección destinataria. */
  to?: string
}

/**
 * Envía el mail de bienvenida cuando un vet se inscribe al convenio
 * (vía landing público o alta manual). Best-effort.
 */
export async function enviarBienvenidaVet(args: {
  /** Necesario para generar el link firmado a /eutanasia/datos-pago/<token>. */
  vetId: string
  nombre: string
  apellido: string
  email: string
}): Promise<BienvenidaResult> {
  const to = args.email
  if (!isResendConfigured()) {
    console.warn('[eutanasia-mailer] Resend no configurado, salto mail de bienvenida a', to)
    return { ok: false, estado: 'omitido_sin_resend', to }
  }
  const fromUsed = (() => { try { return getFromAddress() } catch { return '(no resolvable)' } })()
  const baseUrl = (process.env.PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '').replace(/\/+$/, '')
  const nombreCompleto = nombreCompletoVet(args.nombre, args.apellido)

  // Token firmado (30d, consumo único en el endpoint) para que el vet pueda
  // completar sus datos bancarios desde el correo sin tener que hacer login.
  let linkDatosPago = ''
  try {
    if (baseUrl && args.vetId) {
      const token = createVetToken(args.vetId, 'datos_pago')
      linkDatosPago = `${baseUrl}/eutanasia/datos-pago/${token}`
    }
  } catch (e) {
    console.warn('[eutanasia-mailer] no se pudo crear token datos_pago:', e)
  }

  console.log(`[eutanasia-mailer] enviando bienvenida → from=${fromUsed} to=${to}`)

  try {
    const contacto = await getContacto()
    const res = await sendEmail({
      to,
      subject: 'Bienvenido al convenio de eutanasias - Alma Animal',
      html: renderBienvenida({ nombreCompleto, baseUrl, linkDatosPago, contacto }),
      preview_text: 'Te damos la bienvenida a nuestra red de veterinarios.',
      tags: [{ name: 'tipo', value: 'eutanasia_bienvenida_vet' }],
    })
    if (res.ok) {
      console.log(`[eutanasia-mailer] OK bienvenida a ${to}, message_id=${res.message_id}`)
      return { ok: true, estado: 'enviado', message_id: res.message_id, from_used: fromUsed, to }
    } else {
      console.error(`[eutanasia-mailer] FAIL bienvenida a ${to} desde ${fromUsed}: ${res.error}`)
      return { ok: false, estado: 'error', error: res.error, from_used: fromUsed, to }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[eutanasia-mailer] EXC bienvenida a ${to}:`, msg)
    return { ok: false, estado: 'error', error: msg, from_used: fromUsed, to }
  }
}

export function renderBienvenida({ nombreCompleto, baseUrl, linkDatosPago, contacto }: { nombreCompleto: string; baseUrl: string; linkDatosPago: string; contacto: Contacto }): string {
  const landingUrl = baseUrl ? `${baseUrl}/convenio-eutanasias` : 'https://crematorioalmaanimal.cl/convenio-eutanasias'
  const card = (n: string, titulo: string, texto: string) => `
      <div style="background:${BRAND.cream};border:1px solid ${BRAND.hairline};border-radius:10px;padding:16px;margin-bottom:14px">
        <p style="margin:0;font-size:14px"><strong style="color:${BRAND.navy}">${n}. ${titulo}</strong></p>
        <p style="margin:4px 0 0;font-size:13px;color:${BRAND.muted};line-height:1.5">${texto}</p>
      </div>`
  const cuerpo = `
      <p style="margin:0 0 14px;font-size:15px">Hola <strong>${escapeHtml(nombreCompleto)}</strong>,</p>
      <p style="margin:0 0 18px;font-size:14px;line-height:1.6">
        Gracias por sumarte a nuestra red de veterinarios para eutanasias a domicilio.
        Trabajamos para acompañar a las familias en un momento difícil, y tu disponibilidad
        nos ayuda a llegar a más lugares con un servicio cercano y digno.
      </p>
      <h2 style="margin:24px 0 12px;font-size:16px;color:${BRAND.navy}">Cómo vamos a trabajar</h2>
      ${card('1', 'Recibes cotizaciones por correo.', 'Cuando una familia nos solicite una eutanasia en alguna de tus comunas y en uno de tus horarios disponibles, te enviamos un correo con todos los datos (nombre de la mascota, dirección, fecha, hora y monto a pagar).')}
      ${card('2', 'Confirmas si puedes tomarla.', 'Si te queda cómodo, presionas "Confirma que puedes aquí" en el mismo correo. La solicitud queda asignada a tu nombre y te enviamos un segundo correo con los datos de contacto de la familia para que coordines directamente.')}
      ${card('3', 'Atiendes el caso.', 'Hablas con la familia, evalúas el caso y, si corresponde, realizas el servicio en el día y hora acordados.')}
      ${card('4', 'Confirmas y te pagamos.', 'Cuando termines, confirmas en el correo que el servicio se realizó y recibes el pago el día hábil siguiente.')}
      <h2 style="margin:26px 0 12px;font-size:16px;color:${BRAND.navy}">Cómo te pagamos</h2>
      <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:16px">
        <p style="margin:0;font-size:14px;line-height:1.55">
          <strong>Pagamos al día hábil siguiente</strong> al que realices el servicio.
          La tarifa depende del peso de la mascota y es la misma para todos los
          veterinarios del convenio.
        </p>
        <p style="margin:10px 0 0;font-size:13px">
          <a href="${landingUrl}" style="color:${BRAND.navy};font-weight:600">Ver tabla de precios →</a>
        </p>
      </div>
      ${linkDatosPago ? `
      <div style="background:#fff;border:2px solid ${BRAND.navy};border-radius:10px;padding:18px;margin:18px 0;text-align:center">
        <p style="margin:0 0 12px;font-size:14px;color:${BRAND.ink};line-height:1.5">
          Para que podamos transferirte los pagos, necesitamos tus datos bancarios.
        </p>
        <a href="${linkDatosPago}" style="display:inline-block;background:${BRAND.navy};color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:8px">
          Ingresa tus datos para transferirte los pagos
        </a>
        <p style="margin:10px 0 0;font-size:11px;color:${BRAND.muted}">Este enlace es personal y válido por 30 días. Por seguridad, los datos se cargan una sola vez.</p>
      </div>` : ''}
      <h2 style="margin:26px 0 10px;font-size:16px;color:${BRAND.navy}">¿Necesitas ajustar algo?</h2>
      <p style="margin:0;font-size:14px;line-height:1.55">
        Si quieres cambiar tus comunas, tus horarios o cualquier dato, escríbenos a
        <a href="mailto:${escapeHtml(contacto.correo)}" style="color:${BRAND.navy}">${escapeHtml(contacto.correo)}</a>
        y lo actualizamos a la brevedad.
      </p>`
  return renderEmailLayout({ titulo: '¡Bienvenido al convenio!', contexto: CONTEXTO, bodyHtml: cuerpo, contacto })
}

// ─── Mail "confirma realización del servicio" ────────────────────────────────

export interface RealizarServicioArgs {
  vetEmail: string
  vetNombre: string
  cotizacion: {
    id: string
    mascota_nombre: string
    cliente_nombre: string
    cliente_telefono: string
    fecha_servicio: string
    hora_servicio: string
    direccion: string
    comuna: string
    precio_snapshot?: string
  }
  /** URL completa con token firmado a /eutanasia/realizado/<token>. */
  linkRealizado: string
}

export async function enviarMailRealizarServicio(args: RealizarServicioArgs): Promise<BienvenidaResult> {
  const to = args.vetEmail
  if (!isResendConfigured()) {
    console.warn('[eutanasia-mailer] Resend no configurado, salto mail realizarServicio a', to)
    return { ok: false, estado: 'omitido_sin_resend', to }
  }
  const fromUsed = (() => { try { return getFromAddress() } catch { return '(no resolvable)' } })()
  console.log(`[eutanasia-mailer] enviando realizarServicio → from=${fromUsed} to=${to} cotizacion=${args.cotizacion.id}`)
  try {
    const contacto = await getContacto()
    const res = await sendEmail({
      to,
      subject: `Confirma cuando termines el servicio — ${args.cotizacion.mascota_nombre}`,
      html: renderRealizarServicio(args, contacto),
      preview_text: `Confirma la realización del servicio de ${args.cotizacion.mascota_nombre}.`,
      tags: [
        { name: 'tipo', value: 'eutanasia_post_confirmar' },
        { name: 'cotizacion_id', value: String(args.cotizacion.id) },
      ],
    })
    if (res.ok) {
      console.log(`[eutanasia-mailer] OK realizarServicio a ${to}, message_id=${res.message_id}`)
      return { ok: true, estado: 'enviado', message_id: res.message_id, from_used: fromUsed, to }
    }
    console.error(`[eutanasia-mailer] FAIL realizarServicio a ${to}: ${res.error}`)
    return { ok: false, estado: 'error', error: res.error, from_used: fromUsed, to }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[eutanasia-mailer] EXC realizarServicio a ${to}:`, msg)
    return { ok: false, estado: 'error', error: msg, from_used: fromUsed, to }
  }
}

export function renderRealizarServicio(args: RealizarServicioArgs, contacto: Contacto): string {
  const c = args.cotizacion
  const precio = parseInt(c.precio_snapshot || '0', 10)
  const cuerpo = `
      <p style="margin:0 0 14px;font-size:15px">Hola <strong>${escapeHtml(args.vetNombre || 'Dr/a.')}</strong>,</p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.55">
        Gracias por coordinar con la familia. Una vez que termines el servicio,
        confirma aquí para que podamos procesar tu pago.
      </p>
      <div style="background:${BRAND.cream};border:1px solid ${BRAND.hairline};border-radius:10px;padding:14px;margin:14px 0">
        <p style="margin:0 0 4px;font-size:12px;color:${BRAND.muted}">Servicio</p>
        <p style="margin:0;font-size:14px;font-weight:600">${escapeHtml(c.mascota_nombre)} · ${escapeHtml(c.cliente_nombre)}</p>
        <p style="margin:4px 0 0;font-size:13px;color:${BRAND.muted}">${escapeHtml(formatDate(c.fecha_servicio))} ${escapeHtml(formatHoraDia(c.hora_servicio))} hs · ${escapeHtml(c.direccion)}, ${escapeHtml(c.comuna)}</p>
        ${precio > 0 ? `<p style="margin:8px 0 0;font-size:13px"><strong>Pago acordado:</strong> ${escapeHtml(fmtPrecio(precio))}</p>` : ''}
      </div>
      <div style="text-align:center;margin:20px 0 8px">
        <a href="${args.linkRealizado}" style="display:inline-block;background:${BRAND.navy};color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:10px">
          Confirma aquí una vez realizado el servicio
        </a>
      </div>
      <p style="margin:14px 0 0;font-size:11px;color:#94a3b8;text-align:center">
        Presiona el botón solo después de realizar la eutanasia. Coordinaremos tu pago para el día hábil siguiente.
      </p>
      <p style="margin:20px 0 0;font-size:13px;color:${BRAND.muted};line-height:1.5">
        Si surgió algún inconveniente durante el servicio o necesitas reagendar, contáctanos por los medios de abajo.
      </p>`
  return renderEmailLayout({ titulo: 'Confirma cuando realices el servicio', contexto: CONTEXTO, bodyHtml: cuerpo, contacto })
}

// ─── Mail de agradecimiento + datos de pago ──────────────────────────────────

export interface AgradecimientoArgs {
  vetEmail: string
  vetNombre: string
  cotizacion: {
    id: string
    mascota_nombre: string
    precio_snapshot?: string
  }
  /** Fecha en que se realizó el servicio (ISO 'YYYY-MM-DD'). */
  fechaRealizacionISO: string
}

export async function enviarMailAgradecimiento(args: AgradecimientoArgs): Promise<BienvenidaResult> {
  const to = args.vetEmail
  if (!isResendConfigured()) {
    console.warn('[eutanasia-mailer] Resend no configurado, salto mail agradecimiento a', to)
    return { ok: false, estado: 'omitido_sin_resend', to }
  }
  const fromUsed = (() => { try { return getFromAddress() } catch { return '(no resolvable)' } })()
  console.log(`[eutanasia-mailer] enviando agradecimiento → from=${fromUsed} to=${to}`)
  try {
    const contacto = await getContacto()
    const res = await sendEmail({
      to,
      subject: `¡Gracias por tu trabajo! Tu pago está coordinado`,
      html: renderAgradecimiento(args, contacto),
      preview_text: 'Coordinamos el pago de tu servicio. ¡Gracias!',
      tags: [
        { name: 'tipo', value: 'eutanasia_post_realizado' },
        { name: 'cotizacion_id', value: String(args.cotizacion.id) },
      ],
    })
    if (res.ok) {
      console.log(`[eutanasia-mailer] OK agradecimiento a ${to}, message_id=${res.message_id}`)
      return { ok: true, estado: 'enviado', message_id: res.message_id, from_used: fromUsed, to }
    }
    console.error(`[eutanasia-mailer] FAIL agradecimiento a ${to}: ${res.error}`)
    return { ok: false, estado: 'error', error: res.error, from_used: fromUsed, to }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[eutanasia-mailer] EXC agradecimiento a ${to}:`, msg)
    return { ok: false, estado: 'error', error: msg, from_used: fromUsed, to }
  }
}

/**
 * Calcula la fecha del próximo día hábil a partir de la fecha del servicio.
 * Expuesto para reusarlo desde la UI admin que necesite mostrar la misma fecha.
 */
export function fechaProximoPago(fechaRealizacionISO: string): string {
  const m = fechaRealizacionISO.match(/^(\d{4})-(\d{2})-(\d{2})/)
  let base: Date
  if (m) {
    base = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0)
  } else {
    base = new Date()
  }
  const proximo = agregarDiasHabiles(base, 1)
  return formatDate(proximo)
}

// ─── Mail al CLIENTE: un vet de la red tomó su solicitud ─────────────────────

export interface ClienteVetAsignadoArgs {
  clienteEmail: string
  clienteNombre: string
  mascotaNombre: string
  vetNombre: string
  vetTelefono: string
  fechaServicio: string
  horaServicio: string
}

/**
 * Avisa al cliente (tutor) que un veterinario de la red confirmó disponibilidad
 * para la eutanasia a domicilio, entregándole los datos de contacto del vet.
 * Best-effort.
 */
export async function enviarClienteVetAsignado(args: ClienteVetAsignadoArgs): Promise<BienvenidaResult> {
  const to = args.clienteEmail
  if (!to) return { ok: false, estado: 'omitido_sin_resend', to }
  if (!isResendConfigured()) {
    console.warn('[eutanasia-mailer] Resend no configurado, salto aviso al cliente', to)
    return { ok: false, estado: 'omitido_sin_resend', to }
  }
  try {
    const contacto = await getContacto()
    const res = await sendEmail({
      to,
      subject: `Un veterinario confirmó la atención de ${args.mascotaNombre}`,
      html: renderClienteVetAsignado(args, contacto),
      preview_text: `Un veterinario de la red se contactará contigo por ${args.mascotaNombre}.`,
      tags: [{ name: 'tipo', value: 'eutanasia_cliente_vet_asignado' }],
    })
    return res.ok
      ? { ok: true, estado: 'enviado', message_id: res.message_id, to }
      : { ok: false, estado: 'error', error: res.error, to }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[eutanasia-mailer] EXC aviso cliente vet asignado:', msg)
    return { ok: false, estado: 'error', error: msg, to }
  }
}

export function renderClienteVetAsignado(args: ClienteVetAsignadoArgs, contacto: Contacto): string {
  const mascota = escapeHtml(args.mascotaNombre)
  const telLimpio = (args.vetTelefono || '').replace(/\D/g, '').slice(-9)
  const saludo = args.clienteNombre ? `Hola <strong>${escapeHtml(args.clienteNombre)}</strong>,` : 'Hola,'
  const cuerpo = `
      <p style="margin:0 0 14px;font-size:15px">${saludo}</p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6">
        Un veterinario de nuestra red confirmó su disponibilidad para acompañar a <strong>${mascota}</strong>
        en su despedida. Se pondrá en contacto contigo para coordinar los detalles.
      </p>
      <div style="background:${BRAND.cream};border:1px solid ${BRAND.hairline};border-radius:10px;padding:16px;margin:16px 0">
        <p style="margin:0 0 6px;font-size:12px;color:${BRAND.muted}">Veterinario asignado</p>
        <p style="margin:0;font-size:15px;font-weight:600">${escapeHtml(args.vetNombre || 'Veterinario de la red')}</p>
        ${telLimpio ? `<p style="margin:4px 0 0;font-size:14px"><a href="tel:+56${telLimpio}" style="color:${BRAND.navy}">+56 ${telLimpio}</a></p>` : ''}
      </div>
      <p style="margin:0;font-size:14px;line-height:1.6">
        Si tienes cualquier duda, escríbenos. Estamos para acompañarte.
      </p>`
  return renderEmailLayout({ titulo: 'Tu solicitud fue tomada', contexto: CONTEXTO, bodyHtml: cuerpo, contacto })
}

// ─── Render compartido: cotización a vet + coordina con la familia ───────────
// Estas dos plantillas se usan desde rutas (cotizaciones/[id]/enviar y
// cotizaciones/aceptar). Viven acá para que TODO el render de correos de
// eutanasia esté centralizado y use la misma estructura visual.

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 12px 6px 0;font-size:12px;color:${BRAND.muted};width:120px;vertical-align:top">${label}</td>
    <td style="padding:6px 0;font-size:14px;color:${BRAND.ink}">${value}</td>
  </tr>`
}

export interface CotizacionEmailArgs {
  vetNombre: string
  c: Record<string, string>
  linkAceptar: string
  /** Si está vacío, no se muestra el bloque "Aún no registras tus datos…". */
  linkDatosPago: string
  contacto: Contacto
}

/** Correo a un vet con una nueva solicitud de eutanasia + botón para aceptar. */
export function renderCotizacionEmail({ vetNombre, c, linkAceptar, linkDatosPago, contacto }: CotizacionEmailArgs): string {
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${c.direccion}, ${c.comuna}, Chile`)}`
  const precio = parseInt(c.precio_snapshot || '0', 10)
  const fechaLeg = formatDate(c.fecha_servicio)
  const cuerpo = `
      <p style="margin:0 0 16px;font-size:15px">Hola <strong>${escapeHtml(vetNombre || 'Dr/a.')}</strong>,</p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.55">Tenemos una solicitud que coincide con tus comunas y horarios disponibles. Estos son los datos:</p>

      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tbody>
          ${row('Mascota', `${escapeHtml(c.mascota_nombre)} (${escapeHtml(c.especie)})`)}
          ${row('Peso', `${escapeHtml(c.peso)} kg`)}
          ${row('Fecha y hora', `${escapeHtml(fechaLeg)} ${escapeHtml(formatHoraDia(c.hora_servicio))} hs`)}
          ${row('Comuna', escapeHtml(c.comuna))}
          ${row('Dirección', `<a href="${mapsUrl}" target="_blank" style="color:${BRAND.navy};text-decoration:underline">${escapeHtml(c.direccion)} (ver mapa)</a>`)}
          ${row('Cliente', escapeHtml(c.cliente_nombre))}
          ${c.notas ? row('Notas', escapeHtml(c.notas)) : ''}
        </tbody>
      </table>

      <div style="background:${BRAND.cream};border:1px solid ${BRAND.hairline};border-radius:10px;padding:14px;margin:20px 0">
        <p style="margin:0;font-size:13px;color:${BRAND.muted}">Pago al veterinario por este servicio:</p>
        <p style="margin:4px 0 0;font-size:22px;font-weight:700;color:${BRAND.navy}">${escapeHtml(fmtPrecio(precio))}</p>
      </div>

      <p style="margin:20px 0 8px;font-size:14px">¿Puedes tomar esta solicitud?</p>

      <div style="text-align:center;margin:18px 0 8px">
        <a href="${linkAceptar}" style="display:inline-block;background:${BRAND.navy};color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:10px">
          Confirma que puedes aquí
        </a>
      </div>

      <p style="margin:20px 0 0;font-size:12px;color:${BRAND.muted}">Si no puedes tomarla, simplemente ignora este correo. Otros veterinarios del convenio también lo recibieron y el primero en confirmar queda asignado.</p>
      <p style="margin:12px 0 0;font-size:11px;color:#94a3b8">Este enlace expira en 72 horas.</p>

      ${linkDatosPago ? `
      <div style="margin:24px 0 0;padding-top:18px;border-top:1px dashed ${BRAND.hairline};text-align:center">
        <p style="margin:0 0 10px;font-size:13px;color:${BRAND.muted}">¿Aún no registras tus datos para transferirte los pagos?</p>
        <a href="${linkDatosPago}" style="display:inline-block;color:${BRAND.navy};font-weight:600;font-size:13px;padding:8px 14px;border:1px solid ${BRAND.navy};border-radius:6px;text-decoration:none">
          Regístralos aquí
        </a>
      </div>` : ''}`
  return renderEmailLayout({ titulo: 'Nueva solicitud de eutanasia', contexto: CONTEXTO, bodyHtml: cuerpo, contacto })
}

export interface CoordinarEmailArgs {
  vetNombre: string
  c: Record<string, string>
  linkConfirmar: string
  /** Si está vacío, no se muestra el bloque "Aún no registras tus datos…". */
  linkDatosPago: string
  contacto: Contacto
}

/** Correo al vet que aceptó: datos de contacto de la familia + botón confirmar. */
export function renderCoordinarEmail({ vetNombre, c, linkConfirmar, linkDatosPago, contacto }: CoordinarEmailArgs): string {
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${c.direccion}, ${c.comuna}, Chile`)}`
  const fechaLeg = formatDate(c.fecha_servicio)
  const horaLeg = formatHoraDia(c.hora_servicio)
  const cuerpo = `
      <p style="margin:0 0 12px;font-size:15px">Hola <strong>${escapeHtml(vetNombre)}</strong>,</p>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.55">Gracias por confirmar tu disponibilidad. Ahora <strong>contacta directamente a la familia</strong> para evaluar el caso y coordinar.</p>

      <div style="background:${BRAND.cream};border:1px solid ${BRAND.hairline};border-radius:10px;padding:14px;margin:16px 0">
        <p style="margin:0 0 6px;font-size:12px;color:${BRAND.muted}">Contacto del cliente</p>
        <p style="margin:0;font-size:15px;font-weight:600">${escapeHtml(c.cliente_nombre)}</p>
        <p style="margin:4px 0 0;font-size:14px"><a href="tel:+56${escapeHtml(c.cliente_telefono)}" style="color:${BRAND.navy}">+56 ${escapeHtml(c.cliente_telefono)}</a></p>
        ${c.cliente_email ? `<p style="margin:2px 0 0;font-size:13px;color:${BRAND.muted}">${escapeHtml(c.cliente_email)}</p>` : ''}
      </div>

      <table style="width:100%;border-collapse:collapse;margin:12px 0">
        <tbody>
          ${row('Mascota', `${escapeHtml(c.mascota_nombre)} (${escapeHtml(c.especie)}, ${escapeHtml(c.peso)} kg)`)}
          ${row('Fecha y hora', `${escapeHtml(fechaLeg)} ${escapeHtml(horaLeg)} hs`)}
          ${row('Dirección', `<a href="${mapsUrl}" target="_blank" style="color:${BRAND.navy}">${escapeHtml(c.direccion)}, ${escapeHtml(c.comuna)} (ver mapa)</a>`)}
          ${c.notas ? row('Notas', escapeHtml(c.notas)) : ''}
        </tbody>
      </table>

      <p style="margin:20px 0 8px;font-size:14px">Una vez que hayas hablado con la familia y confirmen que vas a realizar el servicio, marca acá:</p>

      <div style="text-align:center;margin:18px 0 8px">
        <a href="${linkConfirmar}" style="display:inline-block;background:${BRAND.navy};color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:10px">
          Confirma servicio aquí
        </a>
      </div>

      <p style="margin:18px 0 0;font-size:12px;color:${BRAND.muted}">Si después de hablar con la familia decides que no puedes tomar el caso, simplemente ignora este correo — lo reasignaremos.</p>

      ${linkDatosPago ? `
      <div style="margin:24px 0 0;padding-top:18px;border-top:1px dashed ${BRAND.hairline};text-align:center">
        <p style="margin:0 0 10px;font-size:13px;color:${BRAND.muted}">¿Aún no registras tus datos para transferirte los pagos?</p>
        <a href="${linkDatosPago}" style="display:inline-block;color:${BRAND.navy};font-weight:600;font-size:13px;padding:8px 14px;border:1px solid ${BRAND.navy};border-radius:6px;text-decoration:none">
          Regístralos aquí
        </a>
      </div>` : ''}`
  return renderEmailLayout({ titulo: 'Tomaste la solicitud — siguiente paso', contexto: CONTEXTO, bodyHtml: cuerpo, contacto })
}

export function renderAgradecimiento(args: AgradecimientoArgs, contacto: Contacto): string {
  // Nota: precio intencionalmente NO se muestra en este correo.
  const fechaPago = fechaProximoPago(args.fechaRealizacionISO)
  const datosPago = process.env.EUTANASIA_DATOS_PAGO || ''
  const cuerpo = `
      <p style="margin:0 0 14px;font-size:15px">Hola <strong>${escapeHtml(args.vetNombre || 'Dr/a.')}</strong>,</p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6">
        🙏 Confirmamos la realización del servicio para <strong>${escapeHtml(args.cotizacion.mascota_nombre)}</strong>.
        Juntos damos apoyo a familias en momentos difíciles y tu disponibilidad
        hace que este acompañamiento sea posible.
      </p>
      <p style="margin:0 0 18px;font-size:14px;line-height:1.6">
        Nos pondremos en contacto contigo cuando alguien más necesite nuestro apoyo
        en tus comunas y horarios.
      </p>
      <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:18px;margin:18px 0">
        <p style="margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#047857;font-weight:600">Tu pago</p>
        <p style="margin:0;font-size:14px;color:${BRAND.ink};line-height:1.5">
          Recibirás el pago <strong>${escapeHtml(fechaPago)}</strong> (día hábil siguiente al servicio)${datosPago ? `, en la cuenta:` : '.'}
        </p>
        ${datosPago ? `<div style="margin:10px 0 0;padding:10px;background:#fff;border:1px solid #d1fae5;border-radius:6px;font-size:13px;color:${BRAND.ink};white-space:pre-line;line-height:1.5">${escapeHtml(datosPago)}</div>` : ''}
      </div>`
  return renderEmailLayout({ titulo: '¡Muchas gracias por tu trabajo!', contexto: CONTEXTO, bodyHtml: cuerpo, contacto })
}
