import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, ensureSheet, ensureColumns, updateRow } from '@/lib/datastore'
import { sendEmail, isResendConfigured } from '@/lib/resend-mailer'
import { fmtFecha } from '@/lib/format'
import { todayISO } from '@/lib/dates'
import { getContacto } from '@/lib/email-layout'
import { buildCertificado } from '@/lib/cliente-mailer'
import { registrarEnvio } from '@/lib/correos-log'

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

const VIDEO_MIME: Record<string, string> = {
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', '3gp': 'video/3gpp', mkv: 'video/x-matroska',
}


export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!isResendConfigured()) {
      return NextResponse.json({ error: 'RESEND_API_KEY no configurada' }, { status: 500 })
    }
    const { id } = await params
    const reqBody = await req.json().catch(() => ({}))
    const adjuntarVideo = reqBody?.adjuntar_video === true

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

    const filename = `Certificado_${cliente.nombre_mascota || 'mascota'}_${cliente.codigo || cliente.id}.pdf`

    const attachments: NonNullable<Parameters<typeof sendEmail>[0]['attachments']> = [
      { filename, path: cert.pdf_url, content_type: 'application/pdf' },
    ]

    // Adjuntar el video del servicio (el más reciente) si se pidió y existe.
    let videoAdjuntado = false
    if (adjuntarVideo) {
      let videos: string[] = []
      try { const x = JSON.parse(cliente.videos_servicio || '[]'); if (Array.isArray(x)) videos = x } catch { /* */ }
      const videoUrl = videos[videos.length - 1]
      if (videoUrl) {
        const ext = (videoUrl.split('.').pop() || 'mp4').toLowerCase()
        attachments.push({
          filename: `Video_${cliente.nombre_mascota || 'mascota'}_${cliente.codigo || cliente.id}.${ext}`,
          path: videoUrl,
          content_type: VIDEO_MIME[ext] || 'video/mp4',
        })
        videoAdjuntado = true
      }
    }

    const contacto = await getContacto()
    const opts = buildCertificado({
      email: cliente.email,
      nombreMascota: cliente.nombre_mascota,
      nombreTutor: cliente.nombre_tutor,
      fechaCremacion,
      conVideo: videoAdjuntado,
    }, contacto)

    const res = await sendEmail({
      ...opts,
      from: FROM_DEFAULT,
      reply_to: 'contacto@crematorioalmaanimal.cl',
      attachments,
      // El certificado (y el video, cuando se adjunta) son pesados y personales:
      // no los copiamos al BCC de seguimiento.
      noBcc: true,
    })

    if (!res.ok) {
      await registrarEnvio({ clienteId: cliente.id, tipo: 'certificado', email: cliente.email, ok: false, error: res.error })
      return NextResponse.json({ error: res.error ?? 'No se pudo enviar el correo' }, { status: 502 })
    }
    await registrarEnvio({ clienteId: cliente.id, tipo: 'certificado', email: cliente.email, messageId: res.message_id, ok: true })

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
