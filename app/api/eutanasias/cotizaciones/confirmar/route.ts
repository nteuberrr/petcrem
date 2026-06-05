import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, updateRow } from '@/lib/google-sheets'
import { verifyToken } from '@/lib/eutanasia-tokens'

const SHEET_COTI = 'cotizaciones_eutanasia'

/**
 * POST /api/eutanasias/cotizaciones/confirmar
 * body: { token: string }
 *
 * Endpoint público. Segundo paso: el vet ya aceptó, llamó al cliente, y
 * confirma que va a realizar el servicio. Pasa estado 'aceptada' → 'confirmada'.
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
    if (verif.payload.accion !== 'confirmar') {
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
    if (c.estado === 'confirmada' || c.estado === 'realizada') {
      return NextResponse.json({ ok: true, ya_confirmada: true, mensaje: 'Ya habías confirmado este servicio.' })
    }
    if (c.estado !== 'aceptada') {
      return NextResponse.json({ ok: false, error: `Estado inválido para confirmar: ${c.estado}` })
    }

    const ahora = new Date().toISOString()
    await updateRow(SHEET_COTI, idx, {
      ...c,
      estado: 'confirmada',
      fecha_confirmacion: ahora,
    })

    return NextResponse.json({
      ok: true,
      mascota_nombre: c.mascota_nombre,
      cliente_nombre: c.cliente_nombre,
      fecha_servicio: c.fecha_servicio,
      hora_servicio: c.hora_servicio,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[eutanasias/confirmar] error:', msg)
    return NextResponse.json({ ok: false, error: 'Error procesando tu confirmación.' }, { status: 500 })
  }
}
