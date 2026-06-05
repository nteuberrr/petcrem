import { sendEmail, isResendConfigured } from './resend-mailer'

const COLOR = '#143C64'

/**
 * Envía el mail de bienvenida cuando un vet se inscribe al convenio
 * (vía landing público o alta manual). Es best-effort: si Resend no
 * está configurado o el envío falla, lo loggeamos pero no rompemos
 * la inscripción.
 *
 * El correo:
 *  - Saluda con nombre + apellido.
 *  - Explica el flujo en 3 pasos (recibís cotización → confirmás → atendés).
 *  - Aclara la política de pago: pagamos al día hábil siguiente del servicio.
 *  - Linkea al landing por si quiere consultar tarifas o pedirnos cambios.
 */
export interface BienvenidaResult {
  ok: boolean
  /** 'enviado' si Resend aceptó; 'omitido_sin_resend' si no había key; 'error' si falló. */
  estado: 'enviado' | 'omitido_sin_resend' | 'error'
  message_id?: string
  error?: string
}

export async function enviarBienvenidaVet(args: {
  nombre: string
  apellido: string
  email: string
}): Promise<BienvenidaResult> {
  if (!isResendConfigured()) {
    console.warn('[eutanasia-mailer] Resend no configurado, salto mail de bienvenida a', args.email)
    return { ok: false, estado: 'omitido_sin_resend' }
  }
  const baseUrl = (process.env.PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '').replace(/\/+$/, '')
  const nombreCompleto = `${args.nombre || ''} ${args.apellido || ''}`.trim() || 'Dr/a.'

  try {
    const res = await sendEmail({
      to: args.email,
      subject: 'Bienvenido al convenio de eutanasias - Alma Animal',
      html: renderBienvenida({ nombreCompleto, baseUrl }),
      tags: [{ name: 'tipo', value: 'eutanasia_bienvenida_vet' }],
    })
    if (res.ok) {
      console.log(`[eutanasia-mailer] bienvenida enviada a ${args.email}, message_id=${res.message_id}`)
      return { ok: true, estado: 'enviado', message_id: res.message_id }
    } else {
      console.error(`[eutanasia-mailer] sendEmail devolvió error para ${args.email}:`, res.error)
      return { ok: false, estado: 'error', error: res.error }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[eutanasia-mailer] excepción enviando bienvenida a ${args.email}:`, msg)
    return { ok: false, estado: 'error', error: msg }
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
        <p style="margin:0;font-size:14px"><strong style="color:${COLOR}">1. Recibís cotización por correo.</strong></p>
        <p style="margin:4px 0 0;font-size:13px;color:#475569">
          Cuando una familia nos solicite una eutanasia en alguna de tus comunas y en uno
          de tus horarios disponibles, te enviamos un mail con todos los datos (nombre de
          la mascota, dirección, fecha, hora y monto a pagarte).
        </p>
      </div>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-bottom:16px">
        <p style="margin:0;font-size:14px"><strong style="color:${COLOR}">2. Confirmás si puedes tomarla.</strong></p>
        <p style="margin:4px 0 0;font-size:13px;color:#475569">
          Si te calza, apretás "Confirma que puedes aquí" en el mismo correo. La solicitud
          queda asignada a tu nombre y te enviamos un segundo mail con los datos de contacto
          de la familia para que coordines con ellos directamente.
        </p>
      </div>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-bottom:16px">
        <p style="margin:0;font-size:14px"><strong style="color:${COLOR}">3. Atendés el caso.</strong></p>
        <p style="margin:4px 0 0;font-size:13px;color:#475569">
          Hablás con la familia, evaluás el caso y, si corresponde, realizás el servicio
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

      <h2 style="margin:28px 0 12px;font-size:16px;color:${COLOR}">¿Necesitás ajustar algo?</h2>
      <p style="margin:0;font-size:14px;line-height:1.55">
        Si querés cambiar tus comunas, tus horarios o cualquier dato, escribinos a
        <a href="mailto:info@crematorioalmaanimal.cl" style="color:${COLOR}">info@crematorioalmaanimal.cl</a>
        y lo actualizamos enseguida.
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
