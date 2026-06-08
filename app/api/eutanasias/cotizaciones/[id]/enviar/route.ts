import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, updateRow, appendRow, getNextId, ensureSheet, ensureColumns } from '@/lib/google-sheets'
import { sendBatch, isResendConfigured } from '@/lib/resend-mailer'
import { createToken, createVetToken } from '@/lib/eutanasia-tokens'
import { formatDate, formatHoraDia } from '@/lib/dates'
import { nombreCompletoVet, renderCotizacionEmail } from '@/lib/eutanasia-mailer'
import { getContacto } from '@/lib/email-layout'
import { esAdmin } from '@/lib/roles'

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
  if (!esAdmin((session?.user as { role?: string })?.role)) {
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
    const contacto = await getContacto()
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
        html: renderCotizacionEmail({
          vetNombre: nombreCompletoVet(v.nombre, v.apellido),
          c,
          linkAceptar,
          linkDatosPago,
          contacto,
        }),
        preview_text: `Solicitud de eutanasia para ${c.mascota_nombre} en ${c.comuna}.`,
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
