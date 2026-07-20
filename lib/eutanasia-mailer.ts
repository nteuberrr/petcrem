import { sendEmail, isResendConfigured, getFromAddress } from './resend-mailer'
import { getSheetData } from './datastore'
import { agregarDiasHabiles } from './dias-habiles'
import { formatDate, formatHoraDia } from './dates'
import { fmtPrecio } from './format'
import { createVetToken, createToken } from './eutanasia-tokens'
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

/** Correo del admin para avisos internos: el de seguimiento (empresa_config) o ADMIN_EMAIL. */
async function resolverEmailAdmin(): Promise<string | null> {
  try {
    const rows = await getSheetData('empresa_config')
    const row = rows.find(r => r.id === '1') || rows[0]
    const seg = (row?.email_seguimiento || '').trim()
    if (seg) return seg
  } catch { /* sigue al fallback */ }
  return (process.env.ADMIN_EMAIL || '').trim() || null
}

/** Resumen legible de disponibilidad: "Lun AM/PM · Mié PM · …". */
function resumenHorarios(h?: Record<string, { am?: boolean; pm?: boolean }>): string {
  if (!h) return '—'
  const dias: Record<string, string> = { lun: 'Lun', mar: 'Mar', mie: 'Mié', jue: 'Jue', vie: 'Vie', sab: 'Sáb', dom: 'Dom' }
  const parts: string[] = []
  for (const k of Object.keys(dias)) {
    const v = h[k]
    if (!v) continue
    const slots = [v.am ? 'AM' : '', v.pm ? 'PM' : ''].filter(Boolean).join('/')
    if (slots) parts.push(`${dias[k]} ${slots}`)
  }
  return parts.join(' · ') || '—'
}

/**
 * Aviso INTERNO al admin (correo de seguimiento) cuando un vet nuevo se inscribe
 * al convenio de eutanasias. Best-effort: no rompe la inscripción si falla.
 */
export async function enviarAvisoNuevoVetConvenio(args: {
  nombre: string
  apellido: string
  email: string
  telefono?: string
  rut?: string
  comunas?: string[]
  horarios?: Record<string, { am?: boolean; pm?: boolean }>
}): Promise<void> {
  if (!isResendConfigured()) return
  try {
    const to = await resolverEmailAdmin()
    if (!to) { console.warn('[eutanasia-mailer] sin correo admin para avisar nuevo vet'); return }
    const contacto = await getContacto()
    const nombre = nombreCompletoVet(args.nombre, args.apellido)
    const filas: [string, string][] = [
      ['Nombre', nombre],
      ['Email', args.email || '—'],
      ['Teléfono', args.telefono ? `+56 ${args.telefono}` : '—'],
      ['RUT', args.rut || '—'],
      ['Comunas', (args.comunas || []).join(', ') || '—'],
      ['Disponibilidad', resumenHorarios(args.horarios)],
    ]
    const tabla = filas
      .map(([k, v]) => `<tr><td style="padding:7px 12px;font-weight:700;color:${BRAND.navy};white-space:nowrap;vertical-align:top">${escapeHtml(k)}</td><td style="padding:7px 12px;color:${BRAND.muted}">${escapeHtml(v)}</td></tr>`)
      .join('')
    const cuerpo = `
      <p style="margin:0 0 14px;font-size:15px">Se inscribió un <strong>nuevo veterinario</strong> al convenio de eutanasias a domicilio:</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px;background:${BRAND.cream};border:1px solid ${BRAND.hairline};border-radius:10px;overflow:hidden">${tabla}</table>
      <p style="margin:16px 0 0;font-size:13px;color:${BRAND.muted}">Quedó activo automáticamente. Lo puedes ver y gestionar en <strong>Servicios → Veterinarios</strong>.</p>`
    await sendEmail({
      to,
      subject: `Nuevo veterinario en el convenio: ${nombre}`,
      html: renderEmailLayout({ titulo: 'Nuevo veterinario en el convenio', bodyHtml: cuerpo, contacto }),
      preview_text: `${nombre} se inscribió al convenio de eutanasias a domicilio.`,
      noBcc: true, // aviso interno al admin → no duplicar con el BCC de seguimiento
      tags: [{ name: 'tipo', value: 'aviso_nuevo_vet_convenio' }],
    })
  } catch (e) {
    console.warn('[eutanasia-mailer] aviso nuevo vet falló:', e instanceof Error ? e.message : String(e))
  }
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
      seguimiento: { tipo: 'eutanasia_bienvenida_vet', audiencia: 'Veterinario', nombre: nombreCompleto },
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
  // Fallback a la URL real de la app (el dominio de marca redirige al sitio de
  // marketing y da 404 en las rutas de la app).
  const landingUrl = baseUrl ? `${baseUrl}/convenio-eutanasias` : 'https://petcrem.vercel.app/convenio-eutanasias'
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
      ${card('1', 'Recibes solicitudes por correo.', 'Cuando una familia nos solicite una eutanasia a domicilio en alguna de tus comunas y en uno de tus horarios disponibles, te enviamos un correo con todos los datos (nombre de la mascota, dirección, fecha, hora y monto a pagar).')}
      ${card('2', 'Confirmas si puedes tomarla.', 'Si te queda cómodo, presionas "Confirma que puedes aquí" en el mismo correo. La solicitud queda asignada a tu nombre y te enviamos un segundo correo con los datos de contacto de la familia para que coordines directamente.')}
      ${card('3', 'Vas, evalúas y decides.', 'Es un servicio de evaluación: visitas a la mascota, la evalúas y —si corresponde— realizas la eutanasia con el mayor respeto. Si al evaluar no corresponde, no se realiza.')}
      ${card('4', 'Marcas el resultado y te pagamos.', 'En el correo de coordinación tienes dos botones: "Eutanasia realizada" y "Eutanasia no realizada". Marca el que corresponda al terminar la visita y recibes el pago el día hábil siguiente. Si no se realiza, igual se te paga el valor de la consulta.')}
      <h2 style="margin:26px 0 12px;font-size:16px;color:${BRAND.navy}">Cómo te pagamos</h2>
      <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:16px">
        <p style="margin:0;font-size:14px;line-height:1.55">
          <strong>Pagamos al día hábil siguiente</strong> a la visita.
          Si realizas la eutanasia, la tarifa depende del peso de la mascota (la misma para
          todos los veterinarios del convenio). Si al evaluar no corresponde realizarla,
          igual te pagamos el <strong>valor de la consulta</strong> por la visita.
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
      seguimiento: { tipo: 'eutanasia_agradecimiento', audiencia: 'Veterinario', nombre: args.cotizacion.mascota_nombre },
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
      seguimiento: { tipo: 'eutanasia_cliente_vet_asignado', audiencia: 'Tutor', nombre: args.mascotaNombre },
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

// ─── Mail al CLIENTE: agradecimiento + reseña, tras realizarse el servicio ────

export interface ClienteAgradecimientoArgs {
  clienteEmail: string
  clienteNombre: string
  mascotaNombre: string
}

/**
 * Agradece al tutor una vez que el veterinario marcó el servicio como realizado,
 * e invita a evaluar la atención en Google (si hay google_review_url configurado
 * en empresa_config). Best-effort.
 */
export async function enviarClienteAgradecimientoEutanasia(args: ClienteAgradecimientoArgs): Promise<BienvenidaResult> {
  const to = args.clienteEmail
  if (!to) return { ok: false, estado: 'omitido_sin_resend', to }
  if (!isResendConfigured()) {
    console.warn('[eutanasia-mailer] Resend no configurado, salto agradecimiento al cliente', to)
    return { ok: false, estado: 'omitido_sin_resend', to }
  }
  try {
    const contacto = await getContacto()
    const res = await sendEmail({
      to,
      subject: `Gracias por confiarnos a ${args.mascotaNombre}`,
      html: renderClienteAgradecimientoEutanasia(args, contacto),
      preview_text: `Gracias por preferirnos. Nos encantaría conocer tu opinión.`,
      tags: [{ name: 'tipo', value: 'eutanasia_cliente_agradecimiento' }],
      seguimiento: { tipo: 'eutanasia_cliente_agradecimiento', audiencia: 'Tutor', nombre: args.mascotaNombre },
    })
    return res.ok
      ? { ok: true, estado: 'enviado', message_id: res.message_id, to }
      : { ok: false, estado: 'error', error: res.error, to }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[eutanasia-mailer] EXC agradecimiento al cliente:', msg)
    return { ok: false, estado: 'error', error: msg, to }
  }
}

export function renderClienteAgradecimientoEutanasia(args: ClienteAgradecimientoArgs, contacto: Contacto): string {
  const mascota = escapeHtml(args.mascotaNombre)
  const saludo = args.clienteNombre ? `Hola <strong>${escapeHtml(args.clienteNombre)}</strong>,` : 'Hola,'
  const reseña = contacto.googleReviewUrl
    ? `<div style="text-align:center;margin:24px 0 8px">
        <a href="${escapeHtml(contacto.googleReviewUrl)}" style="display:inline-block;background:${BRAND.amber};color:${BRAND.navy};text-decoration:none;font-weight:700;font-size:16px;padding:14px 34px;border-radius:12px">
          Evalúa nuestra atención
        </a>
      </div>`
    : ''
  const cuerpo = `
      <p style="margin:0 0 14px;font-size:15px">${saludo}</p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6">
        Queremos agradecerte por confiar en nosotros para acompañar a <strong>${mascota}</strong> en su despedida.
        Sabemos lo difícil de este momento y esperamos que todo haya salido bien y que nuestra atención
        haya estado a la altura.
      </p>
      <p style="margin:0 0 8px;font-size:14px;line-height:1.6">
        Tu opinión nos ayuda a seguir mejorando. Si tienes un momento, nos encantaría que evalúes cómo te atendimos:
      </p>
      ${reseña}
      <p style="margin:20px 0 0;font-size:13px;color:${BRAND.muted};line-height:1.55">
        Ante cualquier consulta quedamos disponibles por los medios de contacto de abajo.
        Gracias por permitirnos acompañarte. 🐾
      </p>`
  return renderEmailLayout({ titulo: 'Gracias por preferirnos', contexto: CONTEXTO, bodyHtml: cuerpo, contacto })
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
        <p style="margin:0;font-size:13px;color:${BRAND.muted}">Pago al veterinario si realizas la eutanasia:</p>
        <p style="margin:4px 0 0;font-size:22px;font-weight:700;color:${BRAND.navy}">${escapeHtml(fmtPrecio(precio))}</p>
        <p style="margin:8px 0 0;font-size:12px;color:${BRAND.muted};line-height:1.5">Es un servicio de <strong>evaluación</strong>: vas, evalúas y decides. Si al evaluar no corresponde realizarla, igual se te paga el valor de la <strong>consulta</strong> por la visita.</p>
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
  /** URL completa a /eutanasia/realizado/<token>. */
  linkRealizado: string
  /** URL completa a /eutanasia/no-realizado/<token>. */
  linkNoRealizado: string
  /** Si está vacío, no se muestra el bloque "Aún no registras tus datos…". */
  linkDatosPago: string
  /** URL a /eutanasia/hora-retiro/<token> — el vet informa la hora del retiro del crematorio. */
  linkHoraRetiro: string
  contacto: Contacto
}

/**
 * Correo al vet que aceptó: datos de contacto de la familia + los DOS botones de
 * cierre ("Eutanasia realizada" / "Eutanasia no realizada"). El vet va, evalúa y
 * marca el resultado directamente desde acá (ya no hay paso intermedio de confirmar).
 */
export function renderCoordinarEmail({ vetNombre, c, linkRealizado, linkNoRealizado, linkDatosPago, linkHoraRetiro, contacto }: CoordinarEmailArgs): string {
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${c.direccion}, ${c.comuna}, Chile`)}`
  const fechaLeg = formatDate(c.fecha_servicio)
  const horaLeg = formatHoraDia(c.hora_servicio)
  const cuerpo = `
      <p style="margin:0 0 12px;font-size:15px">Hola <strong>${escapeHtml(vetNombre)}</strong>,</p>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.55">Gracias por tomar esta solicitud. Ahora <strong>contacta directamente a la familia</strong>, coordina la visita y <strong>evalúa</strong> si corresponde realizar la eutanasia.</p>

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

      ${linkHoraRetiro ? `
      <p style="margin:22px 0 10px;font-size:14px"><strong>1) Apenas coordines la hora de la visita con la familia, infórmanosla</strong> para agendar el retiro del crematorio:</p>
      <div style="text-align:center;margin:0 0 6px">
        <a href="${linkHoraRetiro}" style="display:inline-block;background:${BRAND.amber};color:${BRAND.navy};text-decoration:none;font-weight:700;font-size:15px;padding:14px 30px;border-radius:12px;box-shadow:0 4px 12px rgba(242,184,75,.35)">
          🕒 Informar la hora del servicio&nbsp;&nbsp;→
        </a>
      </div>` : ''}

      <p style="margin:22px 0 8px;font-size:14px"><strong>${linkHoraRetiro ? '2) ' : ''}Cuando termines la visita, marca el resultado:</strong></p>

      <div style="text-align:center;margin:14px 0 8px">
        <a href="${linkRealizado}" style="display:inline-block;background:${BRAND.navy};color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 26px;border-radius:10px;margin:0 6px 10px">
          ✅ Eutanasia realizada
        </a>
        <a href="${linkNoRealizado}" style="display:inline-block;background:#fff;color:${BRAND.navy};text-decoration:none;font-weight:700;font-size:15px;padding:13px 25px;border-radius:10px;border:2px solid ${BRAND.navy};margin:0 6px 10px">
          Eutanasia no realizada
        </a>
      </div>

      <p style="margin:14px 0 0;font-size:12px;color:${BRAND.muted};line-height:1.5">
        Marca <strong>"realizada"</strong> si procediste con la eutanasia, o <strong>"no realizada"</strong> si al evaluar no correspondía.
        En ambos casos coordinamos tu pago para el día hábil siguiente. Presiona solo después de la visita.
      </p>

      ${linkDatosPago ? `
      <div style="margin:24px 0 0;padding-top:18px;border-top:1px dashed ${BRAND.hairline};text-align:center">
        <p style="margin:0 0 10px;font-size:13px;color:${BRAND.muted}">¿Aún no registras tus datos para transferirte los pagos?</p>
        <a href="${linkDatosPago}" style="display:inline-block;color:${BRAND.navy};font-weight:600;font-size:13px;padding:8px 14px;border:1px solid ${BRAND.navy};border-radius:6px;text-decoration:none">
          Regístralos aquí
        </a>
      </div>` : ''}`
  return renderEmailLayout({ titulo: 'Tomaste la solicitud — coordina y evalúa', contexto: CONTEXTO, bodyHtml: cuerpo, contacto })
}

/**
 * Envía al vet asignado el correo "coordina con la familia" (datos de contacto de
 * la familia + botones "Eutanasia realizada" / "Eutanasia no realizada"). Lo
 * comparten el flujo natural (cuando un vet acepta la cotización) y la asignación
 * MANUAL desde el admin. Best-effort: no rompe la operación si Resend falla.
 */
export async function enviarCoordinarConFamilia(args: {
  c: Record<string, string>
  /** Fila del vet (hoja vet_convenio_eutanasia): usa id, nombre, apellido, email, datos_pago_completos. */
  vet: Record<string, string>
  baseUrl: string
}): Promise<void> {
  const { c, vet, baseUrl } = args
  if (!vet.email || !isResendConfigured() || !baseUrl) return
  const vetNombre = nombreCompletoVet(vet.nombre, vet.apellido)
  const linkRealizado = `${baseUrl}/eutanasia/realizado/${createToken(c.id, vet.id, 'realizado')}`
  const linkNoRealizado = `${baseUrl}/eutanasia/no-realizado/${createToken(c.id, vet.id, 'no_realizado')}`
  const tieneDatosPago = (vet.datos_pago_completos ?? '').toUpperCase() === 'TRUE'
  const linkDatosPago = tieneDatosPago ? '' : `${baseUrl}/eutanasia/datos-pago/${createVetToken(vet.id, 'datos_pago')}`
  const linkHoraRetiro = `${baseUrl}/eutanasia/hora-retiro/${createToken(c.id, vet.id, 'informar_hora_retiro')}`
  try {
    const contacto = await getContacto()
    await sendEmail({
      to: vet.email,
      subject: `Coordina con la familia — Eutanasia ${c.mascota_nombre}`,
      html: renderCoordinarEmail({ vetNombre: vetNombre || 'Dr/a.', c, linkRealizado, linkNoRealizado, linkDatosPago, linkHoraRetiro, contacto }),
      preview_text: `Datos de contacto de la familia de ${c.mascota_nombre}.`,
      tags: [
        { name: 'tipo', value: 'eutanasia_post_aceptar' },
        { name: 'cotizacion_id', value: String(c.id) },
        { name: 'vet_id', value: String(vet.id) },
      ],
      seguimiento: { tipo: 'eutanasia_coordinar', audiencia: 'Veterinario', nombre: c.mascota_nombre },
    })
  } catch (e) {
    console.warn('[eutanasia-mailer] coordinar con familia falló:', e instanceof Error ? e.message : String(e))
  }
}

export function renderAgradecimiento(args: AgradecimientoArgs, contacto: Contacto): string {
  const fechaPago = fechaProximoPago(args.fechaRealizacionISO)
  const datosPago = process.env.EUTANASIA_DATOS_PAGO || ''
  const precio = parseInt(args.cotizacion.precio_snapshot || '0', 10) || 0
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
        <p style="margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#047857;font-weight:600">Tu pago por este servicio</p>
        ${precio > 0 ? `<p style="margin:0 0 6px;font-size:22px;font-weight:700;color:${BRAND.navy}">${escapeHtml(fmtPrecio(precio))}</p>` : ''}
        <p style="margin:0;font-size:14px;color:${BRAND.ink};line-height:1.5">
          Lo recibirás el <strong>${escapeHtml(fechaPago)}</strong> (día hábil siguiente al servicio)${datosPago ? `, en la cuenta:` : '.'}
        </p>
        ${datosPago ? `<div style="margin:10px 0 0;padding:10px;background:#fff;border:1px solid #d1fae5;border-radius:6px;font-size:13px;color:${BRAND.ink};white-space:pre-line;line-height:1.5">${escapeHtml(datosPago)}</div>` : ''}
      </div>`
  return renderEmailLayout({ titulo: '¡Muchas gracias por tu trabajo!', contexto: CONTEXTO, bodyHtml: cuerpo, contacto })
}

// ─── Mail al TUTOR al agendar: explica el servicio de evaluación + precios ────

export interface ClienteCotizacionArgs {
  clienteEmail: string
  clienteNombre: string
  mascotaNombre: string
  especie: string
  peso: string | number
  /** ISO 'YYYY-MM-DD'. */
  fechaServicio: string
  horaServicio: string
  comuna: string
  /** Precio al cliente si la eutanasia SÍ se realiza (según peso). Incluye el recargo fuera de horario si aplica. */
  precioClienteRealizada: number
  /** Total al cliente si NO se realiza (la consulta). Incluye el recargo fuera de horario si aplica. */
  consultaTotal: number
  /** Recargo fuera de horario ya incluido en los valores de arriba (0 si no aplica). Se muestra como aclaración. */
  recargoFueraHorario?: number
  /** false cuando el tutor NO quiere cremación posterior (omite el párrafo del retiro). Default true. */
  conCremacion?: boolean
}

/**
 * Correo al tutor cuando agenda una eutanasia a domicilio: explica que es un
 * servicio de EVALUACIÓN (un vet de la red evalúa si corresponde) y los precios
 * de cara al tutor — sin desglose interno vet/Alma. Best-effort.
 */
export async function enviarClienteCotizacionEutanasia(args: ClienteCotizacionArgs): Promise<BienvenidaResult> {
  const to = args.clienteEmail
  if (!to) return { ok: false, estado: 'omitido_sin_resend', to }
  if (!isResendConfigured()) {
    console.warn('[eutanasia-mailer] Resend no configurado, salto cotización al tutor', to)
    return { ok: false, estado: 'omitido_sin_resend', to }
  }
  try {
    const contacto = await getContacto()
    const res = await sendEmail({
      to,
      subject: `Recibimos tu solicitud para ${args.mascotaNombre}`,
      html: renderClienteCotizacionEutanasia(args, contacto),
      preview_text: `Estamos buscando un veterinario de nuestra red para ${args.mascotaNombre}.`,
      tags: [{ name: 'tipo', value: 'eutanasia_cliente_cotizacion' }],
      seguimiento: { tipo: 'eutanasia_cliente_cotizacion', audiencia: 'Tutor', nombre: args.mascotaNombre },
    })
    return res.ok
      ? { ok: true, estado: 'enviado', message_id: res.message_id, to }
      : { ok: false, estado: 'error', error: res.error, to }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[eutanasia-mailer] EXC cotización al tutor:', msg)
    return { ok: false, estado: 'error', error: msg, to }
  }
}

export function renderClienteCotizacionEutanasia(args: ClienteCotizacionArgs, contacto: Contacto): string {
  const mascota = escapeHtml(args.mascotaNombre)
  const saludo = args.clienteNombre ? `Hola <strong>${escapeHtml(args.clienteNombre)}</strong>,` : 'Hola,'
  const fechaLeg = formatDate(args.fechaServicio)
  const horaLeg = formatHoraDia(args.horaServicio)
  const cuerpo = `
      <p style="margin:0 0 14px;font-size:15px">${saludo}</p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6">
        Recibimos tu solicitud de <strong>eutanasia a domicilio</strong> para <strong>${mascota}</strong>.
        Estamos buscando un veterinario de nuestra red que pueda asistir el
        <strong>${escapeHtml(fechaLeg)}${horaLeg && horaLeg !== '—' ? ` a las ${escapeHtml(horaLeg)}` : ''}</strong> en <strong>${escapeHtml(args.comuna)}</strong>.
        Apenas uno confirme, te avisamos con sus datos para coordinar.
      </p>

      <h2 style="margin:22px 0 10px;font-size:16px;color:${BRAND.navy}">Cómo funciona</h2>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6">
        Es un servicio de <strong>evaluación a domicilio</strong>. El veterinario visita a ${mascota},
        la evalúa con cuidado y, si corresponde, realiza la eutanasia con el mayor respeto y acompañándote en todo momento.
      </p>

      <div style="background:${BRAND.cream};border:1px solid ${BRAND.hairline};border-radius:10px;padding:16px;margin:16px 0">
        <p style="margin:0 0 10px;font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:${BRAND.muted};font-weight:700">Valores del servicio</p>
        <p style="margin:0 0 6px;font-size:14px;line-height:1.5">
          <strong>Si se realiza la eutanasia:</strong> ${escapeHtml(fmtPrecio(args.precioClienteRealizada))} <span style="color:${BRAND.muted}">(según el peso de ${mascota})</span>
        </p>
        <p style="margin:0;font-size:14px;line-height:1.5">
          <strong>Si al evaluar no corresponde realizarla:</strong> se cobra solo el valor de la <strong>consulta</strong>, ${escapeHtml(fmtPrecio(args.consultaTotal))}.
        </p>
        ${args.recargoFueraHorario && args.recargoFueraHorario > 0 ? `
        <p style="margin:10px 0 0;font-size:13px;line-height:1.5;color:${BRAND.muted}">
          Estos valores incluyen un <strong>recargo por atención fuera de horario</strong> de ${escapeHtml(fmtPrecio(args.recargoFueraHorario))} (fin de semana, feriado o desde las 18:00).${args.conCremacion === false ? '' : ' Si sumas la cremación, este recargo se cobra una sola vez.'}
        </p>` : ''}
      </div>

      ${args.conCremacion === false ? '' : `
      <p style="margin:16px 0 0;font-size:14px;line-height:1.6">
        Una vez realizada la eutanasia, llegaremos en nuestro vehículo a hacer el <strong>retiro</strong> de ${mascota}
        para proceder con el <strong>servicio de cremación</strong>.
      </p>`}
      <p style="margin:14px 0 0;font-size:13px;color:${BRAND.muted};line-height:1.55">
        Cualquier duda, respóndenos este correo o escríbenos por los medios de abajo. Estamos para acompañarte. 🐾
      </p>`
  return renderEmailLayout({ titulo: 'Recibimos tu solicitud', contexto: CONTEXTO, bodyHtml: cuerpo, contacto })
}

// ─── Mail al VET cuando la eutanasia NO se realiza (pago de la consulta) ──────

export interface NoRealizadaArgs {
  vetEmail: string
  vetNombre: string
  mascotaNombre: string
  /** Monto a pagar al vet por la consulta (evaluación sin eutanasia). */
  consultaVet: number
  /** Fecha en que se cerró el caso (ISO 'YYYY-MM-DD'), para calcular el pago. */
  fechaRealizacionISO: string
}

export async function enviarMailNoRealizada(args: NoRealizadaArgs): Promise<BienvenidaResult> {
  const to = args.vetEmail
  if (!to) return { ok: false, estado: 'omitido_sin_resend', to }
  if (!isResendConfigured()) {
    console.warn('[eutanasia-mailer] Resend no configurado, salto mail no-realizada a', to)
    return { ok: false, estado: 'omitido_sin_resend', to }
  }
  try {
    const contacto = await getContacto()
    const res = await sendEmail({
      to,
      subject: `Gracias por la evaluación — coordinamos tu pago`,
      html: renderNoRealizada(args, contacto),
      preview_text: `Registramos la evaluación de ${args.mascotaNombre}. Coordinamos el pago de la consulta.`,
      tags: [{ name: 'tipo', value: 'eutanasia_no_realizada_vet' }],
      seguimiento: { tipo: 'eutanasia_no_realizada_vet', audiencia: 'Veterinario', nombre: args.mascotaNombre },
    })
    return res.ok
      ? { ok: true, estado: 'enviado', message_id: res.message_id, to }
      : { ok: false, estado: 'error', error: res.error, to }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[eutanasia-mailer] EXC no-realizada al vet:', msg)
    return { ok: false, estado: 'error', error: msg, to }
  }
}

export function renderNoRealizada(args: NoRealizadaArgs, contacto: Contacto): string {
  const fechaPago = fechaProximoPago(args.fechaRealizacionISO)
  const cuerpo = `
      <p style="margin:0 0 14px;font-size:15px">Hola <strong>${escapeHtml(args.vetNombre || 'Dr/a.')}</strong>,</p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6">
        Gracias por evaluar a <strong>${escapeHtml(args.mascotaNombre)}</strong>. Registramos que, tras la evaluación,
        <strong>no correspondía realizar la eutanasia</strong>. Igual valoramos tu visita y tu criterio profesional.
      </p>
      <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:18px;margin:18px 0">
        <p style="margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#047857;font-weight:600">Tu pago por la consulta</p>
        <p style="margin:0;font-size:20px;font-weight:700;color:${BRAND.navy}">${escapeHtml(fmtPrecio(args.consultaVet))}</p>
        <p style="margin:8px 0 0;font-size:14px;color:${BRAND.ink};line-height:1.5">
          Lo recibirás el <strong>${escapeHtml(fechaPago)}</strong> (día hábil siguiente).
        </p>
      </div>
      <p style="margin:16px 0 0;font-size:13px;color:${BRAND.muted};line-height:1.55">
        Nos pondremos en contacto contigo cuando alguien más necesite nuestro apoyo en tus comunas y horarios.
      </p>`
  return renderEmailLayout({ titulo: 'Gracias por la evaluación', contexto: CONTEXTO, bodyHtml: cuerpo, contacto })
}
