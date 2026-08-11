import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/eutanasia-tokens'
import { aceptarCotizacion } from '@/lib/eutanasia-aceptar'

/**
 * POST /api/eutanasias/cotizaciones/aceptar
 * body: { token: string }
 *
 * Endpoint público (sin auth). El vet llega desde un link del email con un
 * token firmado. Verificado el token, la toma del caso (marca de la cotización +
 * correo "coordina con la familia" + avisos al tutor) vive en
 * lib/eutanasia-aceptar, COMPARTIDA con el botón de la plantilla de WhatsApp:
 * aceptar tiene que hacer lo mismo desde los dos lados.
 *
 * Si la cotización ya fue tomada por otro vet, devuelve un mensaje informativo
 * sin error.
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
    const res = await aceptarCotizacion({ cotizacionId: cotizacion_id, vetId: vet_id })

    if (!res.ok) {
      const status = res.motivo === 'no_encontrada' ? 404 : res.motivo === 'vet_no_encontrado' ? 404 : 200
      return NextResponse.json({ ok: false, error: res.mensaje }, { status })
    }
    if (res.ya_aceptada) {
      return NextResponse.json({
        ok: true, ya_aceptada: true,
        mensaje: 'Ya habías confirmado esta solicitud. Comunícate con la familia para coordinar.',
      })
    }

    const { c } = res
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
