import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, ensureSheet, ensureColumns, updateRow } from '@/lib/google-sheets'
import { sendEmail, isResendConfigured } from '@/lib/resend-mailer'
import { fmtFecha } from '@/lib/format'
import { todayISO } from '@/lib/dates'
import { renderEmailLayout, getContacto, escapeHtml, BRAND, type Contacto } from '@/lib/email-layout'

const CERT_COLS = [
  'id', 'cliente_id', 'codigo_mascota', 'nombre_mascota',
  'version',
  'fecha_emision', 'hora_emision',
  'emitido_por_id', 'emitido_por_nombre',
  'sin_foto', 'pdf_key', 'pdf_url',
  'enviado_ultima_fecha', 'enviado_ultima_hora', 'enviado_cantidad', 'enviado_a',
  'fecha_creacion',
]

const FROM_DEFAULT = 'Crematorio Alma Animal <contacto@crematorioalmaanimal.cl>'

function bodyTemplate(opts: { nombreMascota: string; nombreTutor: string; fechaCremacion: string; contacto: Contacto }): string {
  const { nombreMascota, nombreTutor, fechaCremacion, contacto } = opts
  const mascota = escapeHtml(nombreMascota)
  const cuerpo = `
      <p style="margin:0 0 14px;font-size:15px">Estimado(a) ${nombreTutor ? `<strong>${escapeHtml(nombreTutor)}</strong>` : 'tutor(a)'},</p>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.6">
        Reciba nuestro más sentido pésame por la partida de <strong>${mascota}</strong>.
        Fue un privilegio para nuestro equipo acompañarles en este momento y brindar el servicio
        de cremación con el cuidado y respeto que ${mascota} merecía.
      </p>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.6">
        Adjunto a este correo encontrará el <strong>Certificado de Cremación</strong> de ${mascota},
        correspondiente al servicio realizado el ${escapeHtml(fechaCremacion)}. Este documento queda
        registrado para sus archivos.
      </p>
      <p style="margin:0;font-size:14px;line-height:1.6">
        Si necesita una copia adicional o tiene cualquier consulta posterior, no dude en escribirnos.
      </p>`
  return renderEmailLayout({ titulo: `Certificado de cremación de ${nombreMascota}`, bodyHtml: cuerpo, contacto })
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

    const contacto = await getContacto()
    const html = bodyTemplate({
      nombreMascota: cliente.nombre_mascota,
      nombreTutor: cliente.nombre_tutor,
      fechaCremacion,
      contacto,
    })

    const filename = `Certificado_${cliente.nombre_mascota || 'mascota'}_${cliente.codigo || cliente.id}.pdf`

    const attachments: Parameters<typeof sendEmail>[0]['attachments'] = [
      { filename, path: cert.pdf_url, content_type: 'application/pdf' },
    ]

    const res = await sendEmail({
      to: cliente.email,
      subject: `Certificado de cremación — ${cliente.nombre_mascota}`,
      html,
      from: FROM_DEFAULT,
      reply_to: 'contacto@crematorioalmaanimal.cl',
      preview_text: `Adjuntamos el certificado de cremación de ${cliente.nombre_mascota}.`,
      attachments,
    })

    if (!res.ok) {
      return NextResponse.json({ error: res.error ?? 'No se pudo enviar el correo' }, { status: 502 })
    }

    // Persistir el envío en la fila del certificado para que el front pueda mostrar
    // "Certificado enviado el DD-MM-YYYY" y evitar reenvíos accidentales.
    try {
      const certIdx = certs.findIndex(c => c.id === cert.id)
      if (certIdx !== -1) {
        const now = new Date()
        const hh = String(now.getHours()).padStart(2, '0')
        const mi = String(now.getMinutes()).padStart(2, '0')
        const previa = parseInt(cert.enviado_cantidad || '0', 10) || 0
        await updateRow('certificados', certIdx, {
          ...cert,
          enviado_ultima_fecha: todayISO(),
          enviado_ultima_hora: `${hh}:${mi}`,
          enviado_cantidad: String(previa + 1),
          enviado_a: cliente.email,
        })
      }
    } catch (err) {
      console.error('[certificado/enviar] persistencia del envío falló (mail ya fue entregado):', err)
    }

    return NextResponse.json({ ok: true, message_id: res.message_id, to: cliente.email })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
