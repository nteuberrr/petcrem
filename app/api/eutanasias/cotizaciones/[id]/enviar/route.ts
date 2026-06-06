import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, updateRow, appendRow, getNextId, ensureSheet, ensureColumns } from '@/lib/google-sheets'
import { sendBatch, isResendConfigured } from '@/lib/resend-mailer'
import { createToken, createVetToken } from '@/lib/eutanasia-tokens'
import { fmtPrecio } from '@/lib/format'
import { formatDate, formatHoraDia } from '@/lib/dates'
import { nombreCompletoVet } from '@/lib/eutanasia-mailer'

const SHEET_COTI = 'cotizaciones_eutanasia'
const SHEET_ENVIOS = 'cotizaciones_eutanasia_envios'
const COLS_ENVIOS = ['id', 'cotizacion_id', 'vet_id', 'vet_email', 'fecha_envio', 'fecha_respuesta', 'estado_envio', 'resend_message_id']

/**
 * POST /api/eutanasias/cotizaciones/[id]/enviar
 * body: { vet_ids: string[] }
 *
 * Envía la cotización por mail a cada vet indicado. Para cada uno crea
 * un token firmado de acción 'aceptar' y arma un correo HTML con todos
 * los datos del caso + un botón gigante "Confirma que puedes aquí" que
 * apunta a `/eutanasia/aceptar/<token>`.
 *
 * Registra cada envío en cotizaciones_eutanasia_envios y deja la cotización
 * en estado 'enviada' (si todavía no estaba) con fecha_envio_cotizacion.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if ((session?.user as { role?: string })?.role !== 'admin') {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  if (!isResendConfigured()) {
    return NextResponse.json({ error: 'RESEND_API_KEY no configurada' }, { status: 500 })
  }
  const baseUrl = (process.env.PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '').replace(/\/+$/, '')
  if (!baseUrl) {
    return NextResponse.json({ error: 'PUBLIC_APP_URL o NEXTAUTH_URL deben estar configuradas' }, { status: 500 })
  }

  try {
    const { id } = await params
    const body = await req.json()
    const vetIds: string[] = Array.isArray(body.vet_ids) ? body.vet_ids.map(String) : []
    if (vetIds.length === 0) return NextResponse.json({ error: 'No seleccionaste ningún veterinario' }, { status: 400 })

    const cotis = await getSheetData(SHEET_COTI)
    const idxCot = cotis.findIndex(r => r.id === id)
    if (idxCot === -1) return NextResponse.json({ error: 'Cotización no encontrada' }, { status: 404 })
    const c = cotis[idxCot]
    if (c.estado === 'aceptada' || c.estado === 'confirmada' || c.estado === 'realizada') {
      return NextResponse.json({ error: `La cotización ya está en estado "${c.estado}"; no se puede reenviar.` }, { status: 400 })
    }

    const vets = await getSheetData('vet_convenio_eutanasia')
    const vetsSeleccionados = vets.filter(v => vetIds.includes(v.id))
    if (vetsSeleccionados.length === 0) return NextResponse.json({ error: 'Ningún veterinario válido' }, { status: 400 })

    await ensureSheet(SHEET_ENVIOS)
    await ensureColumns(SHEET_ENVIOS, COLS_ENVIOS)
    const envíosExistentes = await getSheetData(SHEET_ENVIOS)

    // Construir los emails
    const emails = vetsSeleccionados.map(v => {
      const token = createToken(c.id, v.id, 'aceptar')
      const linkAceptar = `${baseUrl}/eutanasia/aceptar/${token}`
      // Si el vet aún no completó datos bancarios, agregamos un CTA al final
      // del mail con un link a /eutanasia/datos-pago. Si ya los tiene, no
      // ensuciamos el mail con un mensaje irrelevante.
      const tieneDatosPago = (v.datos_pago_completos ?? '').toUpperCase() === 'TRUE'
      const linkDatosPago = tieneDatosPago
        ? ''
        : `${baseUrl}/eutanasia/datos-pago/${createVetToken(v.id, 'datos_pago')}`
      return {
        to: v.email,
        subject: `Solicitud de eutanasia en ${c.comuna} — ${formatDate(c.fecha_servicio)} ${formatHoraDia(c.hora_servicio)}`,
        html: renderEmailCotizacion({
          vetNombre: nombreCompletoVet(v.nombre, v.apellido),
          c,
          linkAceptar,
          linkDatosPago,
        }),
        reply_to: process.env.MAILING_REPLY_TO || undefined,
        tags: [
          { name: 'tipo', value: 'eutanasia_cotizacion' },
          { name: 'cotizacion_id', value: String(c.id) },
          { name: 'vet_id', value: String(v.id) },
        ],
      }
    })

    const results = await sendBatch(emails)

    // Registrar envíos
    const ahora = new Date().toISOString()
    let okCount = 0
    let failCount = 0
    for (let i = 0; i < vetsSeleccionados.length; i++) {
      const v = vetsSeleccionados[i]
      const r = results[i]
      if (r.ok) okCount++; else failCount++
      const envioId = await getNextId(SHEET_ENVIOS)
      await appendRow(SHEET_ENVIOS, {
        id: envioId,
        cotizacion_id: c.id,
        vet_id: v.id,
        vet_email: v.email,
        fecha_envio: r.ok ? ahora : '',
        fecha_respuesta: '',
        estado_envio: r.ok ? 'enviada' : 'error',
        resend_message_id: r.message_id || '',
      })
      void envíosExistentes
    }

    // Actualizar la cotización
    const partial: Record<string, string> = {}
    if (!c.fecha_envio_cotizacion) partial.fecha_envio_cotizacion = ahora
    if (c.estado === 'creada') partial.estado = 'enviada'
    if (Object.keys(partial).length > 0) {
      await updateRow(SHEET_COTI, idxCot, { ...c, ...partial })
    }

    return NextResponse.json({
      ok: true,
      enviados: okCount,
      fallidos: failCount,
      total: vetsSeleccionados.length,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[eutanasias/enviar] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

interface RenderArgs {
  vetNombre: string
  c: Record<string, string>
  linkAceptar: string
  /** Si está vacío, no se muestra el bloque "Aún no registras tus datos…". */
  linkDatosPago: string
}

function renderEmailCotizacion({ vetNombre, c, linkAceptar, linkDatosPago }: RenderArgs): string {
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${c.direccion}, ${c.comuna}, Chile`)}`
  const precio = parseInt(c.precio_snapshot || '0', 10)
  const COLOR = '#143C64'
  const fechaLeg = formatDate(c.fecha_servicio)
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" /></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f5f6f8;color:#222">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px">
    <div style="background:${COLOR};color:#fff;padding:24px;border-radius:12px 12px 0 0">
      <p style="margin:0;font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:.85">Alma Animal · Convenio Eutanasias</p>
      <h1 style="margin:6px 0 0;font-size:22px;font-weight:700">Nueva solicitud de eutanasia</h1>
    </div>
    <div style="background:#fff;padding:24px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb;border-top:0">
      <p style="margin:0 0 16px;font-size:15px">Hola <strong>${escapeHtml(vetNombre || 'Dr/a.')}</strong>,</p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.55">Tenemos una solicitud que coincide con tus comunas y horarios disponibles. Estos son los datos:</p>

      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tbody>
          ${row('Mascota', `${escapeHtml(c.mascota_nombre)} (${escapeHtml(c.especie)})`)}
          ${row('Peso', `${escapeHtml(c.peso)} kg`)}
          ${row('Fecha y hora', `${escapeHtml(fechaLeg)} ${escapeHtml(formatHoraDia(c.hora_servicio))} hs`)}
          ${row('Comuna', escapeHtml(c.comuna))}
          ${row('Dirección', `<a href="${mapsUrl}" target="_blank" style="color:${COLOR};text-decoration:underline">${escapeHtml(c.direccion)} (ver mapa)</a>`)}
          ${row('Cliente', escapeHtml(c.cliente_nombre))}
          ${c.notas ? row('Notas', escapeHtml(c.notas)) : ''}
        </tbody>
      </table>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin:20px 0">
        <p style="margin:0;font-size:13px;color:#475569">Pago al veterinario por este servicio:</p>
        <p style="margin:4px 0 0;font-size:22px;font-weight:700;color:${COLOR}">${escapeHtml(fmtPrecio(precio))}</p>
      </div>

      <p style="margin:20px 0 8px;font-size:14px">¿Puedes tomar esta solicitud?</p>

      <div style="text-align:center;margin:18px 0 8px">
        <a href="${linkAceptar}" style="display:inline-block;background:${COLOR};color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:10px">
          Confirma que puedes aquí
        </a>
      </div>

      <p style="margin:20px 0 0;font-size:12px;color:#64748b">Si no puedes tomarla, simplemente ignora este correo. Otros veterinarios del convenio también lo recibieron y el primero en confirmar queda asignado.</p>
      <p style="margin:12px 0 0;font-size:11px;color:#94a3b8">Este enlace expira en 72 horas. Si tienes dudas, escríbenos a info@crematorioalmaanimal.cl.</p>

      ${linkDatosPago ? `
      <div style="margin:24px 0 0;padding-top:18px;border-top:1px dashed #e2e8f0;text-align:center">
        <p style="margin:0 0 10px;font-size:13px;color:#475569">¿Aún no registras tus datos para transferirte los pagos?</p>
        <a href="${linkDatosPago}" style="display:inline-block;color:${COLOR};font-weight:600;font-size:13px;padding:8px 14px;border:1px solid ${COLOR};border-radius:6px;text-decoration:none">
          Regístralos aquí
        </a>
      </div>` : ''}
    </div>
  </div>
</body>
</html>`
}

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 12px 6px 0;font-size:12px;color:#64748b;width:120px;vertical-align:top">${label}</td>
    <td style="padding:6px 0;font-size:14px;color:#0f172a">${value}</td>
  </tr>`
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
