import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { getSheetData, ensureSheet, ensureColumns } from '@/lib/google-sheets'
import { sendEmail, isResendConfigured } from '@/lib/resend-mailer'
import { fmtFecha } from '@/lib/format'

const LOGO_CID = 'alma-logo-mail'
let logoBufferCache: Buffer | null = null

async function getLogoBuffer(): Promise<Buffer | null> {
  if (logoBufferCache) return logoBufferCache
  try {
    const fp = path.join(process.cwd(), 'public', 'logo-alma-mail.png')
    const buf = await fs.readFile(fp)
    logoBufferCache = buf
    return buf
  } catch (err) {
    console.warn('[certificado/enviar] no se pudo leer logo del public/:', err)
    return null
  }
}

const CERT_COLS = [
  'id', 'cliente_id', 'codigo_mascota', 'nombre_mascota',
  'version',
  'fecha_emision', 'hora_emision',
  'emitido_por_id', 'emitido_por_nombre',
  'sin_foto', 'pdf_key', 'pdf_url',
  'fecha_creacion',
]

const FROM_DEFAULT = 'Crematorio Alma Animal <contacto@crematorioalmaanimal.cl>'

function bodyTemplate(opts: { nombreMascota: string; nombreTutor: string; fechaCremacion: string; logoSrc: string }): string {
  const { nombreMascota, nombreTutor, fechaCremacion, logoSrc } = opts
  // Header en 2 columnas: nombre/lema a la izquierda, logo a la derecha.
  // Usa <table> con width fijos para máxima compatibilidad con Gmail/Outlook.
  // El logo se referencia via cid:... porque va adjunto inline al mensaje MIME.
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Certificado de cremación — ${nombreMascota}</title>
</head>
<body style="margin:0;padding:0;background:#f7f7f5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#262626;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" width="600" style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e6e6e0;">
    <tr>
      <td style="background:#1f2937;padding:24px 32px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
          <tr>
            <td valign="middle" style="text-align:left;">
              <h1 style="margin:0;font-size:22px;letter-spacing:0.5px;color:#ffffff;font-weight:600;">Crematorio Alma Animal</h1>
              <p style="margin:6px 0 0 0;color:#cbd5e1;font-size:13px;">Cuidamos su recuerdo con respeto</p>
            </td>
            <td valign="middle" width="96" style="text-align:right;">
              ${logoSrc ? `<img src="${logoSrc}" alt="Alma Animal" width="80" height="80" style="display:inline-block;border:0;width:80px;height:auto;" />` : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:32px;">
        <p style="margin:0 0 14px 0;font-size:15px;">Estimado(a) ${nombreTutor || 'tutor(a)'},</p>
        <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">
          Reciba nuestro más sentido pésame por la partida de <strong>${nombreMascota}</strong>.
          Fue un privilegio para nuestro equipo acompañarles en este momento y brindar el servicio
          de cremación con el cuidado y respeto que su compañero(a) merecía.
        </p>
        <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">
          Adjunto a este correo encontrará el <strong>Certificado de Cremación</strong> correspondiente
          al servicio realizado el ${fechaCremacion}. Este documento queda registrado para sus archivos.
        </p>
        <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">
          Si necesita una copia adicional o tiene cualquier consulta posterior, no dude en escribirnos
          al <a href="mailto:contacto@crematorioalmaanimal.cl" style="color:#4f46e5;text-decoration:none;">contacto@crematorioalmaanimal.cl</a>.
        </p>
        <p style="margin:24px 0 0 0;font-size:15px;line-height:1.55;">
          Con respeto y cariño,<br/>
          <strong>Equipo Alma Animal</strong>
        </p>
      </td>
    </tr>
    <tr>
      <td style="background:#f7f7f5;padding:18px 32px;border-top:1px solid #e6e6e0;text-align:center;font-size:12px;color:#737373;">
        Crematorio Alma Animal &middot; Santiago, Chile<br/>
        <a href="https://crematorioalmaanimal.cl" style="color:#4f46e5;text-decoration:none;">crematorioalmaanimal.cl</a>
      </td>
    </tr>
  </table>
</body>
</html>`
}


export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!isResendConfigured()) {
      return NextResponse.json({ error: 'RESEND_API_KEY no configurada' }, { status: 500 })
    }
    const { id } = await params

    // Asegurar schema una sola vez antes de leer (con caché interno del lib se vuelve idempotente).
    await ensureSheet('certificados')
    await ensureColumns('certificados', CERT_COLS)

    // Leemos clientes + ciclos + certificados en paralelo para reducir el costo total
    // de la operación (cada llamada cuenta contra la cuota "Read requests per minute").
    const [clientes, ciclos, certs] = await Promise.all([
      getSheetData('clientes'),
      getSheetData('ciclos'),
      getSheetData('certificados'),
    ])

    const cliente = clientes.find(c => c.id === id)
    if (!cliente) return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 })
    if (!cliente.email || !cliente.email.trim()) {
      return NextResponse.json({ error: 'El cliente no tiene email registrado' }, { status: 400 })
    }

    const propios = certs
      .filter(c => c.cliente_id === id && c.pdf_url)
      .sort((a, b) => (parseInt(b.version) || 0) - (parseInt(a.version) || 0))
    const cert = propios[0]
    if (!cert) {
      return NextResponse.json({
        error: 'Aún no se ha generado el certificado. Generalo primero con "Generar certificado".',
      }, { status: 400 })
    }

    const ciclo = ciclos.find(c => c.id === cliente.ciclo_id)
    const fechaCremacion = ciclo ? fmtFecha(ciclo.fecha) : '—'

    const logoBuffer = await getLogoBuffer()

    const html = bodyTemplate({
      nombreMascota: cliente.nombre_mascota,
      nombreTutor: cliente.nombre_tutor,
      fechaCremacion,
      // Si el logo se pudo leer del disco, lo embebemos como CID inline (no depende
      // del dominio público). Si por algún motivo el archivo no está, el <img> se omite.
      logoSrc: logoBuffer ? `cid:${LOGO_CID}` : '',
    })

    const filename = `Certificado_${cliente.nombre_mascota || 'mascota'}_${cliente.codigo || cliente.id}.pdf`

    const attachments: Parameters<typeof sendEmail>[0]['attachments'] = [
      { filename, path: cert.pdf_url, content_type: 'application/pdf' },
    ]
    if (logoBuffer) {
      attachments!.push({
        filename: 'logo-alma.png',
        content: logoBuffer,
        content_type: 'image/png',
        content_id: LOGO_CID,
        content_disposition: 'inline',
      })
    }

    const res = await sendEmail({
      to: cliente.email,
      subject: `Certificado de cremación — ${cliente.nombre_mascota}`,
      html,
      from: FROM_DEFAULT,
      reply_to: 'contacto@crematorioalmaanimal.cl',
      attachments,
    })

    if (!res.ok) {
      return NextResponse.json({ error: res.error ?? 'No se pudo enviar el correo' }, { status: 502 })
    }

    return NextResponse.json({ ok: true, message_id: res.message_id, to: cliente.email })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
