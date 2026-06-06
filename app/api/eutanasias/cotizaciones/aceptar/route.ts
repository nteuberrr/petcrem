import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, updateRow, ensureSheet, ensureColumns } from '@/lib/google-sheets'
import { verifyToken, createToken } from '@/lib/eutanasia-tokens'
import { sendEmail, isResendConfigured } from '@/lib/resend-mailer'
import { fmtPrecio } from '@/lib/format'
import { formatDate } from '@/lib/dates'

const SHEET_COTI = 'cotizaciones_eutanasia'
const SHEET_ENVIOS = 'cotizaciones_eutanasia_envios'
const COLS_ENVIOS = ['id', 'cotizacion_id', 'vet_id', 'vet_email', 'fecha_envio', 'fecha_respuesta', 'estado_envio', 'resend_message_id']

/**
 * POST /api/eutanasias/cotizaciones/aceptar
 * body: { token: string }
 *
 * Endpoint público (sin auth). El vet llega desde un link del email con un
 * token firmado. Si verifica:
 *  - Marca la cotización como 'aceptada' y vet_id_asignado = vet.
 *  - Actualiza el registro de envío del vet como 'aceptada'.
 *  - Genera un nuevo token 'confirmar' y manda un mail al vet con instrucciones
 *    de contactar al cliente + link "confirma servicio aquí".
 *
 * Si la cotización ya fue tomada por otro vet (estado distinto a 'enviada'),
 * devuelve un mensaje informativo sin error.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const token: string = String(body.token ?? '')
    const verif = verifyToken(token)
    if (!verif.ok || !verif.payload) {
      return NextResponse.json({
        ok: false,
        error: verif.error === 'expired' ? 'El enlace ya expiró. Pídenos uno nuevo.' :
               verif.error === 'invalid_signature' ? 'Enlace inválido.' :
               'Enlace inválido o dañado.',
      }, { status: 400 })
    }
    if (verif.payload.accion !== 'aceptar') {
      return NextResponse.json({ ok: false, error: 'Acción incorrecta para este enlace.' }, { status: 400 })
    }

    const { cotizacion_id, vet_id } = verif.payload

    const cotis = await getSheetData(SHEET_COTI)
    const idx = cotis.findIndex(r => r.id === cotizacion_id)
    if (idx === -1) return NextResponse.json({ ok: false, error: 'Cotización no encontrada.' }, { status: 404 })
    const c = cotis[idx]

    if (c.estado === 'aceptada' || c.estado === 'confirmada' || c.estado === 'realizada') {
      if (c.vet_id_asignado === vet_id) {
        return NextResponse.json({
          ok: true, ya_aceptada: true,
          mensaje: 'Ya habías confirmado esta solicitud. Comunícate con la familia para coordinar.',
        })
      }
      return NextResponse.json({
        ok: false,
        error: 'Otro veterinario ya tomó esta solicitud. Gracias por tu interés.',
      })
    }
    if (c.estado === 'cancelada') {
      return NextResponse.json({ ok: false, error: 'Esta solicitud fue cancelada.' })
    }

    const vets = await getSheetData('vet_convenio_eutanasia')
    const vet = vets.find(v => v.id === vet_id)
    if (!vet) return NextResponse.json({ ok: false, error: 'Veterinario no encontrado.' }, { status: 404 })

    // Marcar cotización como aceptada
    const ahora = new Date().toISOString()
    const vetNombreCompleto = `${vet.nombre || ''} ${vet.apellido || ''}`.trim()
    await updateRow(SHEET_COTI, idx, {
      ...c,
      estado: 'aceptada',
      vet_id_asignado: vet.id,
      vet_nombre_asignado: vetNombreCompleto,
      vet_email_asignado: vet.email,
      fecha_aceptacion: ahora,
    })

    // Marcar el envío correspondiente como 'aceptada'
    try {
      await ensureSheet(SHEET_ENVIOS)
      await ensureColumns(SHEET_ENVIOS, COLS_ENVIOS)
      const envios = await getSheetData(SHEET_ENVIOS)
      const idxEnvio = envios.findIndex(e => e.cotizacion_id === cotizacion_id && e.vet_id === vet_id)
      if (idxEnvio !== -1) {
        await updateRow(SHEET_ENVIOS, idxEnvio, {
          ...envios[idxEnvio],
          estado_envio: 'aceptada',
          fecha_respuesta: ahora,
        })
      }
    } catch (e) {
      console.warn('[aceptar] no se pudo actualizar el envío:', e)
    }

    // Mandar mail de "comunícate con el cliente + link confirmar"
    const baseUrl = (process.env.PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '').replace(/\/+$/, '')
    if (isResendConfigured() && baseUrl) {
      const tokenConfirmar = createToken(c.id, vet.id, 'confirmar')
      const linkConfirmar = `${baseUrl}/eutanasia/confirmar/${tokenConfirmar}`
      try {
        await sendEmail({
          to: vet.email,
          subject: `Coordina con la familia — Eutanasia ${c.mascota_nombre}`,
          html: renderEmailConfirmar({
            vetNombre: vetNombreCompleto || 'Dr/a.',
            c,
            linkConfirmar,
          }),
          tags: [
            { name: 'tipo', value: 'eutanasia_post_aceptar' },
            { name: 'cotizacion_id', value: String(c.id) },
            { name: 'vet_id', value: String(vet.id) },
          ],
        })
      } catch (e) {
        console.warn('[aceptar] error mandando mail de confirmación:', e)
      }
    }

    return NextResponse.json({
      ok: true,
      cliente_nombre: c.cliente_nombre,
      cliente_telefono: c.cliente_telefono,
      cliente_email: c.cliente_email,
      mascota_nombre: c.mascota_nombre,
      direccion: c.direccion,
      comuna: c.comuna,
      fecha_servicio: c.fecha_servicio,
      hora_servicio: c.hora_servicio,
      precio: c.precio_snapshot,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[eutanasias/aceptar] error:', msg)
    return NextResponse.json({ ok: false, error: 'Error procesando tu confirmación.' }, { status: 500 })
  }
}

function renderEmailConfirmar({ vetNombre, c, linkConfirmar }: { vetNombre: string; c: Record<string, string>; linkConfirmar: string }): string {
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${c.direccion}, ${c.comuna}, Chile`)}`
  const fechaLeg = formatDate(c.fecha_servicio)
  const COLOR = '#143C64'
  const precio = parseInt(c.precio_snapshot || '0', 10)
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8" /></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f5f6f8;color:#222">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px">
    <div style="background:${COLOR};color:#fff;padding:24px;border-radius:12px 12px 0 0">
      <p style="margin:0;font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:.85">Alma Animal · Convenio Eutanasias</p>
      <h1 style="margin:6px 0 0;font-size:20px;font-weight:700">Tomaste la solicitud — siguiente paso</h1>
    </div>
    <div style="background:#fff;padding:24px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb;border-top:0">
      <p style="margin:0 0 12px;font-size:15px">Hola ${escapeHtml(vetNombre)},</p>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.55">Gracias por confirmar tu disponibilidad. Ahora <strong>contacta directamente a la familia</strong> para evaluar el caso y coordinar.</p>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin:16px 0">
        <p style="margin:0 0 6px;font-size:12px;color:#64748b">Contacto del cliente</p>
        <p style="margin:0;font-size:15px;font-weight:600">${escapeHtml(c.cliente_nombre)}</p>
        <p style="margin:4px 0 0;font-size:14px"><a href="tel:+56${escapeHtml(c.cliente_telefono)}" style="color:${COLOR}">+56 ${escapeHtml(c.cliente_telefono)}</a></p>
        ${c.cliente_email ? `<p style="margin:2px 0 0;font-size:13px;color:#475569">${escapeHtml(c.cliente_email)}</p>` : ''}
      </div>

      <table style="width:100%;border-collapse:collapse;margin:12px 0">
        <tbody>
          ${row('Mascota', `${escapeHtml(c.mascota_nombre)} (${escapeHtml(c.especie)}, ${escapeHtml(c.peso)} kg)`)}
          ${row('Fecha y hora', `${escapeHtml(fechaLeg)} ${escapeHtml(c.hora_servicio)} hs`)}
          ${row('Dirección', `<a href="${mapsUrl}" target="_blank" style="color:${COLOR}">${escapeHtml(c.direccion)}, ${escapeHtml(c.comuna)} (ver mapa)</a>`)}
          ${row('Pago acordado', `<strong>${escapeHtml(fmtPrecio(precio))}</strong>`)}
          ${c.notas ? row('Notas', escapeHtml(c.notas)) : ''}
        </tbody>
      </table>

      <p style="margin:20px 0 8px;font-size:14px">Una vez que hayas hablado con la familia y confirmen que vas a realizar el servicio, marca acá:</p>

      <div style="text-align:center;margin:18px 0 8px">
        <a href="${linkConfirmar}" style="display:inline-block;background:${COLOR};color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:10px">
          Confirma servicio aquí
        </a>
      </div>

      <p style="margin:18px 0 0;font-size:12px;color:#64748b">Si después de hablar con la familia decides que no puedes tomar el caso, simplemente ignora este correo — lo reasignaremos.</p>
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
