import { sendEmail, isResendConfigured, getFromAddress } from './resend-mailer'
import { agregarDiasHabiles } from './dias-habiles'
import { formatDate } from './dates'
import { fmtPrecio } from './format'

const COLOR = '#143C64'
const TELEFONO = process.env.EMPRESA_TELEFONO_CONTACTO || '+56 9 4053 8499'
const WEB = process.env.EMPRESA_WEB || 'crematorioalmaanimal.cl'
const EMAIL_CONTACTO = 'info@crematorioalmaanimal.cl'

/**
 * Envía el mail de bienvenida cuando un vet se inscribe al convenio
 * (vía landing público o alta manual). Es best-effort: si Resend no
 * está configurado o el envío falla, lo loggeamos pero no rompemos
 * la inscripción.
 *
 * El correo:
 *  - Saluda con nombre + apellido.
 *  - Explica el flujo en 3 pasos (recibe cotización → confirma → atiende).
 *  - Aclara la política de pago: pagamos al día hábil siguiente del servicio.
 *  - Linkea al landing por si quiere consultar tarifas o pedirnos cambios.
 */
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

export async function enviarBienvenidaVet(args: {
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
  const nombreCompleto = `${args.nombre || ''} ${args.apellido || ''}`.trim() || 'Dr/a.'

  console.log(`[eutanasia-mailer] enviando bienvenida → from=${fromUsed} to=${to}`)

  try {
    const res = await sendEmail({
      to,
      subject: 'Bienvenido al convenio de eutanasias - Alma Animal',
      html: renderBienvenida({ nombreCompleto, baseUrl }),
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

function renderBienvenida({ nombreCompleto, baseUrl }: { nombreCompleto: string; baseUrl: string }): string {
  const landingUrl = baseUrl ? `${baseUrl}/convenio-eutanasias` : 'https://crematorioalmaanimal.cl/convenio-eutanasias'
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" /></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f5f6f8;color:#222">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px">
    <div style="background:${COLOR};color:#fff;padding:28px 24px;border-radius:12px 12px 0 0">
      <p style="margin:0;font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:.85">Alma Animal · Convenio Eutanasias</p>
      <h1 style="margin:6px 0 0;font-size:24px;font-weight:700">¡Bienvenido al convenio!</h1>
    </div>

    <div style="background:#fff;padding:28px 24px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb;border-top:0">
      <p style="margin:0 0 14px;font-size:15px">Hola <strong>${escapeHtml(nombreCompleto)}</strong>,</p>

      <p style="margin:0 0 18px;font-size:14px;line-height:1.6">
        Gracias por sumarte a nuestra red de veterinarios para eutanasias a domicilio.
        Trabajamos para acompañar a las familias en un momento difícil, y tu disponibilidad
        nos ayuda a llegar a más lugares con un servicio cercano y digno.
      </p>

      <h2 style="margin:24px 0 12px;font-size:16px;color:${COLOR}">Cómo vamos a trabajar</h2>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-bottom:16px">
        <p style="margin:0;font-size:14px"><strong style="color:${COLOR}">1. Recibes cotizaciones por correo.</strong></p>
        <p style="margin:4px 0 0;font-size:13px;color:#475569">
          Cuando una familia nos solicite una eutanasia en alguna de tus comunas y en uno
          de tus horarios disponibles, te enviamos un correo con todos los datos (nombre de
          la mascota, dirección, fecha, hora y monto a pagar).
        </p>
      </div>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-bottom:16px">
        <p style="margin:0;font-size:14px"><strong style="color:${COLOR}">2. Confirmas si puedes tomarla.</strong></p>
        <p style="margin:4px 0 0;font-size:13px;color:#475569">
          Si te queda cómodo, presionas "Confirma que puedes aquí" en el mismo correo. La solicitud
          queda asignada a tu nombre y te enviamos un segundo correo con los datos de contacto
          de la familia para que coordines con ellos directamente.
        </p>
      </div>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-bottom:16px">
        <p style="margin:0;font-size:14px"><strong style="color:${COLOR}">3. Atiendes el caso.</strong></p>
        <p style="margin:4px 0 0;font-size:13px;color:#475569">
          Hablas con la familia, evalúas el caso y, si corresponde, realizas el servicio
          en el día y hora acordados.
        </p>
      </div>

      <h2 style="margin:28px 0 12px;font-size:16px;color:${COLOR}">Cómo te pagamos</h2>

      <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:16px">
        <p style="margin:0;font-size:14px;line-height:1.55">
          <strong>Pagamos al día hábil siguiente</strong> al que realices el servicio.
          La tarifa depende del peso de la mascota y es la misma para todos los
          veterinarios del convenio.
        </p>
        <p style="margin:10px 0 0;font-size:13px">
          <a href="${landingUrl}" style="color:${COLOR};font-weight:600">Ver tabla de precios →</a>
        </p>
      </div>

      <h2 style="margin:28px 0 12px;font-size:16px;color:${COLOR}">¿Necesitas ajustar algo?</h2>
      <p style="margin:0;font-size:14px;line-height:1.55">
        Si quieres cambiar tus comunas, tus horarios o cualquier dato, escríbenos a
        <a href="mailto:info@crematorioalmaanimal.cl" style="color:${COLOR}">info@crematorioalmaanimal.cl</a>
        y lo actualizamos a la brevedad.
      </p>

      <p style="margin:24px 0 0;font-size:13px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:16px">
        Gracias por confiar en este proyecto.<br/>
        <strong style="color:#0f172a">Equipo Alma Animal</strong>
      </p>
    </div>
  </div>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ─── Mail "confirma realización del servicio" ────────────────────────────────
// Se dispara después de que el vet confirma que va a dar el servicio (estado
// 'confirmada'). El vet recibe un correo con un botón para confirmar, una vez
// que ya realizó el servicio, que efectivamente se concretó — eso pasa el
// estado a 'realizada' y dispara el siguiente mail (agradecimiento).

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
    const res = await sendEmail({
      to,
      subject: `Confirma cuando termines el servicio — ${args.cotizacion.mascota_nombre}`,
      html: renderRealizarServicio(args),
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

function renderRealizarServicio(args: RealizarServicioArgs): string {
  const c = args.cotizacion
  const precio = parseInt(c.precio_snapshot || '0', 10)
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8" /></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f5f6f8;color:#222">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px">
    <div style="background:${COLOR};color:#fff;padding:24px;border-radius:12px 12px 0 0">
      <p style="margin:0;font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:.85">Alma Animal · Convenio Eutanasias</p>
      <h1 style="margin:6px 0 0;font-size:20px;font-weight:700">Confirma cuando hayas realizado el servicio</h1>
    </div>
    <div style="background:#fff;padding:24px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb;border-top:0">
      <p style="margin:0 0 14px;font-size:15px">Hola <strong>${escapeHtml(args.vetNombre || 'Dr/a.')}</strong>,</p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.55">
        Gracias por coordinar con la familia. Una vez que termines el servicio,
        confirma aquí para que podamos procesar tu pago.
      </p>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin:14px 0">
        <p style="margin:0 0 4px;font-size:12px;color:#64748b">Servicio</p>
        <p style="margin:0;font-size:14px;font-weight:600">${escapeHtml(c.mascota_nombre)} · ${escapeHtml(c.cliente_nombre)}</p>
        <p style="margin:4px 0 0;font-size:13px;color:#475569">${escapeHtml(formatDate(c.fecha_servicio))} ${escapeHtml(c.hora_servicio)} hs · ${escapeHtml(c.direccion)}, ${escapeHtml(c.comuna)}</p>
        ${precio > 0 ? `<p style="margin:8px 0 0;font-size:13px"><strong>Pago acordado:</strong> ${escapeHtml(fmtPrecio(precio))}</p>` : ''}
      </div>

      <div style="text-align:center;margin:20px 0 8px">
        <a href="${args.linkRealizado}" style="display:inline-block;background:${COLOR};color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:10px">
          Confirma aquí una vez realizado el servicio
        </a>
      </div>

      <p style="margin:14px 0 0;font-size:11px;color:#94a3b8;text-align:center">
        Presiona el botón solo después de realizar la eutanasia. Coordinaremos tu pago para el día hábil siguiente.
      </p>

      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />

      <h3 style="margin:0 0 8px;font-size:14px;color:${COLOR}">¿Tuviste un problema? ¿Necesitas contactarnos?</h3>
      <p style="margin:0 0 8px;font-size:13px;color:#475569;line-height:1.5">
        Si surgió algún inconveniente durante el servicio o necesitas reagendar, escríbenos o llámanos:
      </p>
      <ul style="margin:0;padding-left:18px;font-size:13px;color:#0f172a;line-height:1.7">
        <li>Teléfono: <a href="tel:${escapeHtml(TELEFONO)}" style="color:${COLOR};text-decoration:none">${escapeHtml(TELEFONO)}</a></li>
        <li>Correo: <a href="mailto:${EMAIL_CONTACTO}" style="color:${COLOR};text-decoration:none">${EMAIL_CONTACTO}</a></li>
        <li>Web: <a href="https://${WEB}" style="color:${COLOR};text-decoration:none">${WEB}</a></li>
      </ul>
    </div>
  </div>
</body>
</html>`
}

// ─── Mail de agradecimiento + datos de pago ──────────────────────────────────
// Se dispara cuando el vet confirma que realizó el servicio (estado 'realizada').
// Contiene el mensaje de agradecimiento, la fecha del próximo día hábil en que
// se acreditará el pago y, si está configurada, la cuenta bancaria a usar.

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
    const res = await sendEmail({
      to,
      subject: `¡Gracias por tu trabajo! Tu pago está coordinado`,
      html: renderAgradecimiento(args),
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
 * Lo expongo además para usarlo desde otras partes del flujo (ej. UI admin
 * que necesite mostrar la misma fecha que el vet ve en el mail).
 */
export function fechaProximoPago(fechaRealizacionISO: string): string {
  // parseFecha entiende ISO y otros; armamos un Date local primero.
  const m = fechaRealizacionISO.match(/^(\d{4})-(\d{2})-(\d{2})/)
  let base: Date
  if (m) {
    base = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0)
  } else {
    base = new Date()
  }
  const proximo = agregarDiasHabiles(base, 1)
  // Formato DD/MM/YYYY para usuario.
  return formatDate(proximo)
}

function renderAgradecimiento(args: AgradecimientoArgs): string {
  const c = args.cotizacion
  const precio = parseInt(c.precio_snapshot || '0', 10)
  const fechaPago = fechaProximoPago(args.fechaRealizacionISO)
  const datosPago = process.env.EUTANASIA_DATOS_PAGO || ''
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8" /></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f5f6f8;color:#222">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px">
    <div style="background:${COLOR};color:#fff;padding:28px 24px;border-radius:12px 12px 0 0;text-align:center">
      <p style="margin:0;font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:.85">Alma Animal · Convenio Eutanasias</p>
      <div style="font-size:42px;margin:8px 0">🙏</div>
      <h1 style="margin:0;font-size:22px;font-weight:700">¡Muchas gracias por trabajar con nosotros!</h1>
    </div>

    <div style="background:#fff;padding:28px 24px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb;border-top:0">
      <p style="margin:0 0 14px;font-size:15px">Hola <strong>${escapeHtml(args.vetNombre || 'Dr/a.')}</strong>,</p>

      <p style="margin:0 0 16px;font-size:14px;line-height:1.6">
        Confirmamos la realización del servicio para <strong>${escapeHtml(c.mascota_nombre)}</strong>.
        Juntos damos apoyo a familias en momentos difíciles y tu disponibilidad
        hace que este acompañamiento sea posible.
      </p>

      <p style="margin:0 0 18px;font-size:14px;line-height:1.6">
        Nos pondremos en contacto contigo cuando alguien más necesite nuestro apoyo
        en tus comunas y horarios.
      </p>

      <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:18px;margin:18px 0">
        <p style="margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#047857;font-weight:600">Tu pago</p>
        ${precio > 0 ? `<p style="margin:0 0 6px;font-size:20px;font-weight:700;color:#0f172a">${escapeHtml(fmtPrecio(precio))}</p>` : ''}
        <p style="margin:0;font-size:14px;color:#0f172a;line-height:1.5">
          Recibirás el pago <strong>${escapeHtml(fechaPago)}</strong> (día hábil siguiente al servicio)${datosPago ? `, en la cuenta:` : '.'}
        </p>
        ${datosPago ? `<div style="margin:10px 0 0;padding:10px;background:#fff;border:1px solid #d1fae5;border-radius:6px;font-size:13px;color:#0f172a;white-space:pre-line;line-height:1.5">${escapeHtml(datosPago)}</div>` : ''}
      </div>

      <p style="margin:18px 0 0;font-size:13px;color:#64748b">
        Si tienes alguna consulta, escríbenos a
        <a href="mailto:${EMAIL_CONTACTO}" style="color:${COLOR}">${EMAIL_CONTACTO}</a>
        o llámanos al <a href="tel:${escapeHtml(TELEFONO)}" style="color:${COLOR}">${escapeHtml(TELEFONO)}</a>.
      </p>

      <p style="margin:24px 0 0;font-size:13px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:16px">
        Con cariño,<br/>
        <strong style="color:#0f172a">Equipo Alma Animal</strong>
      </p>
    </div>
  </div>
</body>
</html>`
}
