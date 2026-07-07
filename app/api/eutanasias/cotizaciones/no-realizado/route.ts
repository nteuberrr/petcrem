import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, updateByIdIf, deleteById } from '@/lib/datastore'
import { verifyToken } from '@/lib/eutanasia-tokens'
import { getConsultaEutanasia } from '@/lib/eutanasia-precios'
import { enviarMailNoRealizada, fechaProximoPago } from '@/lib/eutanasia-mailer'
import { isWhatsappConfigured, avisarAdminsWhatsapp } from '@/lib/whatsapp'

const SHEET_COTI = 'cotizaciones_eutanasia'

/**
 * POST /api/eutanasias/cotizaciones/no-realizado
 * body: { token: string }
 *
 * Endpoint público. El vet, tras evaluar a la mascota a domicilio, marca que la
 * eutanasia NO correspondía. Pasa estado 'aceptada' → 'no_realizada', congela el
 * pago al vet por la consulta y le manda al vet el correo de pago de la consulta.
 * Sobre la ficha de cremación asociada: si sigue en borrador (no ingresada) la
 * ELIMINA; si ya fue ingresada, la CONSERVA y deja una alerta en la cotización
 * (Servicios → Eutanasias) + aviso al equipo por WhatsApp. No se avisa al tutor.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const token: string = String(body.token ?? '')
    const verif = verifyToken(token)
    if (!verif.ok || !verif.payload) {
      return NextResponse.json({
        ok: false,
        error: verif.error === 'expired' ? 'El enlace ya expiró.' :
               verif.error === 'invalid_signature' ? 'Enlace inválido.' :
               'Enlace inválido o dañado.',
      }, { status: 400 })
    }
    if (verif.payload.accion !== 'no_realizado') {
      return NextResponse.json({ ok: false, error: 'Acción incorrecta para este enlace.' }, { status: 400 })
    }

    const { cotizacion_id, vet_id } = verif.payload
    const cotis = await getSheetData(SHEET_COTI)
    const idx = cotis.findIndex(r => r.id === cotizacion_id)
    if (idx === -1) return NextResponse.json({ ok: false, error: 'Cotización no encontrada.' }, { status: 404 })
    const c = cotis[idx]

    if (c.vet_id_asignado !== vet_id) {
      return NextResponse.json({ ok: false, error: 'Esta cotización ya no está asignada a tu cuenta.' })
    }
    if (c.estado === 'no_realizada') {
      return NextResponse.json({
        ok: true, ya_resuelta: true,
        mensaje: 'Ya habías marcado esta evaluación como no realizada.',
        mascota_nombre: c.mascota_nombre,
        fecha_pago: c.fecha_realizacion ? fechaProximoPago(c.fecha_realizacion.slice(0, 10)) : '',
        precio: c.consulta_vet_snapshot,
      })
    }
    if (c.estado === 'realizada') {
      return NextResponse.json({ ok: false, error: 'Esta eutanasia ya fue marcada como realizada.' })
    }
    if (c.estado === 'cancelada') {
      return NextResponse.json({ ok: false, error: 'Esta cotización fue cancelada.' })
    }
    if (c.estado !== 'aceptada') {
      return NextResponse.json({ ok: false, error: `Estado inválido para marcar como no realizada: ${c.estado}` })
    }

    // Monto al vet por la consulta: snapshot congelado o el configurado hoy
    // (un snapshot vacío o en 0 cae al valor de config — nunca se paga $0).
    const consultaVet = parseInt(c.consulta_vet_snapshot || '', 10) || (await getConsultaEutanasia()).vet
    const ahora = new Date().toISOString()
    const cambios = {
      estado: 'no_realizada',
      fecha_realizacion: ahora, // fecha de cierre de la evaluación (para calcular el pago)
      estado_pago: 'pendiente_pago',
      consulta_vet_snapshot: String(consultaVet),
    }
    // Flip atómico desde 'aceptada', exigiendo asignación a este vet.
    const gano = await updateByIdIf(SHEET_COTI, cotizacion_id, { estado: 'aceptada', vet_id_asignado: vet_id }, cambios)
    if (!gano) {
      const fresco = (await getSheetData(SHEET_COTI)).find(r => r.id === cotizacion_id)
      return NextResponse.json({
        ok: true, ya_resuelta: true,
        mensaje: 'Ya habías marcado esta evaluación como no realizada.',
        mascota_nombre: c.mascota_nombre,
        fecha_pago: fresco?.fecha_realizacion ? fechaProximoPago(fresco.fecha_realizacion.slice(0, 10)) : '',
        precio: fresco?.consulta_vet_snapshot || String(consultaVet),
      })
    }

    // La mascota sigue viva. Si la ficha de cremación asociada AÚN es un borrador
    // (el equipo no la ingresó), se elimina — no hay nada que cremar. Pero si el
    // equipo YA la ingresó, NO se toca: puede haber gestión en curso. En ese caso
    // queda una alerta en la cotización (Servicios → Eutanasias, derivada del
    // estado de la ficha) y se avisa al equipo por WhatsApp para que decida.
    if (c.cliente_id) {
      try {
        const clientes = await getSheetData('clientes')
        const ficha = clientes.find(r => String(r.id) === String(c.cliente_id))
        if (ficha) {
          if ((ficha.estado || '').toLowerCase() === 'borrador') {
            await deleteById('clientes', String(c.cliente_id))
          } else if (isWhatsappConfigured()) {
            try {
              await avisarAdminsWhatsapp(
                `⚠️ Eutanasia N° ${c.id} (${c.mascota_nombre} · ${c.cliente_nombre}): el veterinario marcó que la eutanasia NO se realizó, pero la ficha de cremación ${ficha.codigo || '(sin código)'} YA está ingresada. Revísala en Servicios → Eutanasias.`)
            } catch { /* best-effort */ }
          }
        }
      } catch (e) {
        console.warn('[eutanasias/no-realizado] no se pudo procesar la ficha de cremación:', e)
      }
    }

    // Correo al vet con el pago de la consulta. Best-effort.
    if (c.vet_email_asignado) {
      try {
        await enviarMailNoRealizada({
          vetEmail: c.vet_email_asignado,
          vetNombre: c.vet_nombre_asignado || '',
          mascotaNombre: c.mascota_nombre,
          consultaVet,
          fechaRealizacionISO: ahora.slice(0, 10),
        })
      } catch (e) {
        console.error('[eutanasias/no-realizado] error mail no-realizada al vet:', e)
      }
    }

    return NextResponse.json({
      ok: true,
      mascota_nombre: c.mascota_nombre,
      fecha_pago: fechaProximoPago(ahora.slice(0, 10)),
      precio: String(consultaVet),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[eutanasias/no-realizado] error:', msg)
    return NextResponse.json({ ok: false, error: 'Error procesando tu confirmación.' }, { status: 500 })
  }
}
