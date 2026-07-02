import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, updateById, updateByIdIf, ensureSheet, ensureColumns } from '@/lib/datastore'
import { verifyToken, createToken } from '@/lib/eutanasia-tokens'
import { nombreCompletoVet, enviarCoordinarConFamilia, enviarClienteVetAsignado } from '@/lib/eutanasia-mailer'
import { enviarTextoWhatsapp, isWhatsappConfigured } from '@/lib/whatsapp'
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
 *  - Manda el mail "coordina con la familia" con los dos botones de cierre
 *    (Eutanasia realizada / no realizada) — el vet marca el resultado directamente.
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

    if (c.estado === 'aceptada' || c.estado === 'realizada') {
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

    // Marcar cotización como aceptada — ATÓMICO: solo gana si sigue en 'enviada'.
    // Esto resuelve la carrera "dos vets aceptan casi a la vez": el segundo update
    // no matchea (estado ya != 'enviada') y devuelve false.
    const ahora = new Date().toISOString()
    const vetNombreCompleto = nombreCompletoVet(vet.nombre, vet.apellido)
    const gano = await updateByIdIf(
      SHEET_COTI,
      cotizacion_id,
      { estado: 'enviada' },
      {
        estado: 'aceptada',
        vet_id_asignado: vet.id,
        vet_nombre_asignado: vetNombreCompleto,
        vet_email_asignado: vet.email,
        fecha_aceptacion: ahora,
      },
    )
    if (!gano) {
      // Otro proceso cambió el estado entre la lectura y el update. Re-leemos
      // para responder con precisión (nuestro propio doble-clic vs. otro vet).
      const fresco = (await getSheetData(SHEET_COTI)).find(r => r.id === cotizacion_id)
      if (fresco?.vet_id_asignado === vet_id) {
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

    // Marcar el envío correspondiente como 'aceptada'
    try {
      await ensureSheet(SHEET_ENVIOS)
      await ensureColumns(SHEET_ENVIOS, COLS_ENVIOS)
      const envios = await getSheetData(SHEET_ENVIOS)
      const idxEnvio = envios.findIndex(e => e.cotizacion_id === cotizacion_id && e.vet_id === vet_id)
      if (idxEnvio !== -1) {
        await updateById(SHEET_ENVIOS, envios[idxEnvio].id, {
          ...envios[idxEnvio],
          estado_envio: 'aceptada',
          fecha_respuesta: ahora,
        })
      }
    } catch (e) {
      console.warn('[aceptar] no se pudo actualizar el envío:', e)
    }

    // Mandar el correo "coordina con la familia" con los 2 botones (realizada /
    // no realizada). Helper compartido con la asignación manual del admin.
    const baseUrl = (process.env.PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '').replace(/\/+$/, '')
    await enviarCoordinarConFamilia({ c, vet, baseUrl })

    // Avisar al CLIENTE (tutor) que un vet tomó su caso, con los datos del vet.
    // Best-effort: WhatsApp si la cotización nació del bot (cliente_wa_id) + correo.
    const vetTel = (vet.telefono || '').replace(/\D/g, '').slice(-9)
    const waCliente = (c.cliente_wa_id || '').replace(/\D/g, '')
    if (waCliente && isWhatsappConfigured()) {
      const linkConf = baseUrl ? `${baseUrl}/eutanasia/cliente-confirma/${createToken(c.id, vet.id, 'cliente_confirmar')}` : ''
      const msgWa =
        `Buenas noticias 🐾 Un veterinario de nuestra red confirmó su disponibilidad para acompañar a ${c.mascota_nombre}.\n\n` +
        `Se pondrá en contacto contigo para coordinar:\n` +
        `${vetNombreCompleto}${vetTel ? ` · +56 ${vetTel}` : ''}\n\n` +
        (linkConf ? `Cuando hayas coordinado la visita con el veterinario, confírmanos aquí:\n${linkConf}\n\n` : '') +
        `Cualquier duda, escríbenos por aquí.`
      try { await enviarTextoWhatsapp(waCliente, msgWa) } catch (e) { console.warn('[aceptar] WhatsApp al cliente falló:', e) }
    }
    if (c.cliente_email) {
      try {
        await enviarClienteVetAsignado({
          clienteEmail: c.cliente_email,
          clienteNombre: c.cliente_nombre,
          mascotaNombre: c.mascota_nombre,
          vetNombre: vetNombreCompleto,
          vetTelefono: vet.telefono || '',
          fechaServicio: formatDate(c.fecha_servicio),
          horaServicio: c.hora_servicio,
        })
      } catch (e) { console.warn('[aceptar] correo al cliente falló:', e) }
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
