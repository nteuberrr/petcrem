import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, updateRow } from '@/lib/datastore'
import { verifyToken } from '@/lib/eutanasia-tokens'
import { enviarMailAgradecimiento, fechaProximoPago } from '@/lib/eutanasia-mailer'

const SHEET_COTI = 'cotizaciones_eutanasia'

/**
 * POST /api/eutanasias/cotizaciones/realizado
 * body: { token: string }
 *
 * Endpoint público. Tercer y último paso del flujo del vet: ya confirmó la
 * cita y, una vez realizado el servicio, presiona el botón del correo para
 * marcarlo como hecho. Pasa estado 'confirmada' → 'realizada' y dispara
 * el correo de agradecimiento con la fecha del próximo día hábil de pago.
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
    if (verif.payload.accion !== 'realizado') {
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
    if (c.estado === 'realizada') {
      const fechaPago = c.fecha_realizacion
        ? fechaProximoPago(c.fecha_realizacion.slice(0, 10))
        : ''
      return NextResponse.json({
        ok: true,
        ya_realizada: true,
        mensaje: 'Ya habías confirmado la realización de este servicio.',
        mascota_nombre: c.mascota_nombre,
        fecha_pago: fechaPago,
        precio: c.precio_snapshot,
      })
    }
    if (c.estado === 'cancelada') {
      return NextResponse.json({ ok: false, error: 'Esta cotización fue cancelada.' })
    }
    if (c.estado !== 'confirmada' && c.estado !== 'aceptada') {
      return NextResponse.json({ ok: false, error: `Estado inválido para marcar como realizada: ${c.estado}` })
    }

    const ahora = new Date().toISOString()
    const fechaRealizacionISO = ahora.slice(0, 10) // YYYY-MM-DD
    await updateRow(SHEET_COTI, idx, {
      ...c,
      estado: 'realizada',
      fecha_realizacion: ahora,
      // Inicializamos el estado de pago para que aparezca en el listado
      // histórico esperando que el admin marque "pago confirmado".
      estado_pago: 'pendiente_pago',
    })

    // Disparar correo de agradecimiento. Best-effort.
    const vetNombre = c.vet_nombre_asignado || ''
    const vetEmail = c.vet_email_asignado || ''
    if (vetEmail) {
      try {
        await enviarMailAgradecimiento({
          vetEmail, vetNombre,
          cotizacion: {
            id: c.id,
            mascota_nombre: c.mascota_nombre,
            precio_snapshot: c.precio_snapshot,
          },
          fechaRealizacionISO,
        })
      } catch (e) {
        console.error('[eutanasias/realizado] error disparando mail agradecimiento:', e)
      }
    }

    return NextResponse.json({
      ok: true,
      mascota_nombre: c.mascota_nombre,
      fecha_pago: fechaProximoPago(fechaRealizacionISO),
      precio: c.precio_snapshot,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[eutanasias/realizado] error:', msg)
    return NextResponse.json({ ok: false, error: 'Error procesando tu confirmación.' }, { status: 500 })
  }
}
