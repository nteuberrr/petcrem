import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, ensureSheet, ensureColumns } from '@/lib/datastore'
import { sendEmail, isResendConfigured } from '@/lib/resend-mailer'
import { formatDate } from '@/lib/dates'
import { renderEmailLayout, getContacto, escapeHtml, BRAND, type Contacto } from '@/lib/email-layout'

/**
 * El campo periodo_hasta_mes puede venir como:
 *  - serial Excel "46143" (Sheets lo interpreta como fecha al guardarse) — lo más común
 *  - ISO mes "2026-04"
 *  - fecha ISO completa "2026-04-30"
 * Lo mostramos siempre en formato fecha DD/MM/YYYY vía formatDate (serial-aware).
 */
function fmtPeriodoHasta(raw: string): string {
  if (!raw) return '—'
  // "YYYY-MM" no es una fecha completa: le agregamos el día 1 para poder formatear.
  if (/^\d{4}-\d{2}$/.test(raw)) return formatDate(`${raw}-01`)
  return formatDate(raw)
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

function bodyTemplate(opts: {
  nombreVet: string
  nombreContacto: string
  periodoHasta: string
  contacto: Contacto
}): string {
  const { nombreVet, nombreContacto, periodoHasta, contacto } = opts
  const saludo = nombreContacto ? `Estimado(a) <strong>${escapeHtml(nombreContacto)}</strong>` : `Estimados`
  const cuerpo = `
      <p style="margin:0 0 14px;font-size:15px">${saludo},</p>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.6">
        Adjuntamos el informe de facturación correspondiente a <strong>${escapeHtml(nombreVet)}</strong>, con el detalle
        de los servicios prestados hasta el cierre de <strong>${escapeHtml(periodoHasta)}</strong>.
      </p>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.6">
        En el archivo adjunto encontrarán el detalle por mes con su desglose semanal y el
        total a facturar correspondiente a cada uno, junto con un resumen histórico por especie,
        tramo de peso y tipo de servicio.
      </p>
      <p style="margin:0;font-size:14px;line-height:1.6">
        Para cualquier consulta sobre este informe pueden responder directamente a este correo
        o escribirnos por los medios de abajo.
      </p>`
  return renderEmailLayout({ titulo: 'Informe de facturación', bodyHtml: cuerpo, contacto })
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

    const contacto = await getContacto()
    const html = bodyTemplate({
      nombreVet: vet.nombre,
      nombreContacto: vet.nombre_contacto || '',
      periodoHasta: fmtPeriodoHasta(informe.periodo_hasta_mes),
      contacto,
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

    const res = await sendEmail({
      to: vet.correo,
      subject: `Informe de facturación — ${vet.nombre}`,
      html,
      from: FROM_DEFAULT,
      reply_to: 'contacto@crematorioalmaanimal.cl',
      preview_text: `Informe de facturación de ${vet.nombre}.`,
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
