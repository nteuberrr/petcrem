import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { getSheetData, ensureSheet, ensureColumns } from '@/lib/google-sheets'
import { sendEmail, isResendConfigured } from '@/lib/resend-mailer'
import { formatDateForSheet } from '@/lib/dates'

const MESES_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

/**
 * El campo periodo_hasta_mes puede venir como:
 *  - ISO mes "2026-04"
 *  - serial Excel "46143" (Sheets lo interpreta como fecha al guardarse)
 * Lo formateamos a "Abril 2026".
 */
function fmtPeriodoHasta(raw: string): string {
  if (!raw) return '—'
  if (/^\d{4}-\d{2}$/.test(raw)) {
    const [y, m] = raw.split('-').map(Number)
    return `${MESES_ES[m - 1]} ${y}`
  }
  const iso = formatDateForSheet(raw)
  if (iso) {
    const d = new Date(`${iso}T12:00:00`)
    if (!isNaN(d.getTime())) {
      return `${MESES_ES[d.getMonth()]} ${d.getFullYear()}`
    }
  }
  return raw
}

const INFORMES_COLS = [
  'id', 'veterinaria_id', 'veterinaria_nombre',
  'version', 'formato',
  'periodo_hasta_mes', 'cantidad_meses', 'cantidad_fichas', 'monto_total_clp',
  'fecha_emision', 'hora_emision',
  'emitido_por_id', 'emitido_por_nombre',
  'archivo_key', 'archivo_url',
  'fecha_creacion',
]

const FROM_DEFAULT = 'Crematorio Alma Animal <contacto@crematorioalmaanimal.cl>'
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
    console.warn('[informe/enviar] no se pudo leer logo:', err)
    return null
  }
}

function bodyTemplate(opts: {
  nombreVet: string
  nombreContacto: string
  periodoHasta: string
  logoSrc: string
}): string {
  const { nombreVet, nombreContacto, periodoHasta, logoSrc } = opts
  const saludo = nombreContacto ? `Estimado(a) ${nombreContacto}` : `Estimados`
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Informe de facturación — ${nombreVet}</title>
</head>
<body style="margin:0;padding:0;background:#f7f7f5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#262626;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" width="620" style="max-width:620px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e6e6e0;">
    <tr>
      <td style="background:#143C64;padding:0 24px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
          <tr>
            <td valign="middle" style="text-align:left;">
              <h1 style="margin:0;font-size:30px;letter-spacing:0.3px;color:#ffffff;font-weight:700;line-height:1.15;">Crematorio Alma Animal</h1>
              <p style="margin:6px 0 0 0;color:#c7d4e3;font-size:14px;">Informe de facturación</p>
            </td>
            <td valign="middle" width="150" style="text-align:right;">
              ${logoSrc ? `<img src="${logoSrc}" alt="Alma Animal" width="140" height="140" style="display:inline-block;border:0;width:140px;height:auto;" />` : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:32px;">
        <p style="margin:0 0 14px 0;font-size:15px;">${saludo},</p>
        <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">
          Adjuntamos el informe de facturación correspondiente a <strong>${nombreVet}</strong>, con el detalle
          de los servicios prestados hasta el cierre de <strong>${periodoHasta}</strong>.
        </p>
        <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">
          En el archivo PDF adjunto encontrarán el detalle por mes con su desglose semanal y el
          total a facturar correspondiente a cada uno, junto con un resumen histórico por especie,
          tramo de peso y tipo de servicio.
        </p>
        <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">
          Para cualquier consulta sobre este informe pueden responder directamente a este correo o
          escribirnos al
          <a href="mailto:contacto@crematorioalmaanimal.cl" style="color:#4f46e5;text-decoration:none;">contacto@crematorioalmaanimal.cl</a>.
        </p>
        <p style="margin:24px 0 0 0;font-size:15px;line-height:1.55;">
          Saludos cordiales,<br/>
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

    await ensureSheet('informes_veterinaria')
    await ensureColumns('informes_veterinaria', INFORMES_COLS)

    const [vets, informes] = await Promise.all([
      getSheetData('veterinarios'),
      getSheetData('informes_veterinaria'),
    ])

    const vet = vets.find(v => v.id === id)
    if (!vet) return NextResponse.json({ error: 'Veterinaria no encontrada' }, { status: 404 })
    if (!vet.correo || !vet.correo.trim()) {
      return NextResponse.json({ error: 'La veterinaria no tiene email registrado' }, { status: 400 })
    }

    // Preferimos el último PDF emitido. Si no hay PDF aún, caemos al último Excel
    // (el destinatario lo abre en Excel/Sheets igual).
    const propios = informes
      .filter(r => r.veterinaria_id === id && r.archivo_url)
      .sort((a, b) => (parseInt(b.version) || 0) - (parseInt(a.version) || 0))
    const ultimoPdf = propios.find(r => r.formato === 'pdf')
    const ultimoCualquiera = propios[0]
    const informe = ultimoPdf ?? ultimoCualquiera

    if (!informe) {
      return NextResponse.json({
        error: 'No hay un informe generado todavía. Generá uno en PDF o Excel primero.',
      }, { status: 400 })
    }

    const logoBuffer = await getLogoBuffer()

    const html = bodyTemplate({
      nombreVet: vet.nombre,
      nombreContacto: vet.nombre_contacto || '',
      periodoHasta: fmtPeriodoHasta(informe.periodo_hasta_mes),
      logoSrc: logoBuffer ? `cid:${LOGO_CID}` : '',
    })

    const ext = informe.formato === 'excel' ? 'xlsx' : 'pdf'
    const contentType = informe.formato === 'excel'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/pdf'
    const safeName = (vet.nombre || `vet${id}`).replace(/[^a-zA-Z0-9_-]+/g, '_')
    const filename = `Informe_${safeName}_v${informe.version}.${ext}`

    const attachments: Parameters<typeof sendEmail>[0]['attachments'] = [
      { filename, path: informe.archivo_url, content_type: contentType },
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
      to: vet.correo,
      subject: `Informe de facturación — ${vet.nombre}`,
      html,
      from: FROM_DEFAULT,
      reply_to: 'contacto@crematorioalmaanimal.cl',
      attachments,
    })

    if (!res.ok) {
      return NextResponse.json({ error: res.error ?? 'No se pudo enviar el correo' }, { status: 502 })
    }
    return NextResponse.json({ ok: true, message_id: res.message_id, to: vet.correo, version_enviada: informe.version, formato: informe.formato })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
