import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, updateRow } from '@/lib/datastore'
import { verifyToken } from '@/lib/eutanasia-tokens'
import { bancoValido, tipoCuentaValido } from '@/lib/bancos-cl'
import { todayISO } from '@/lib/dates'

const SHEET = 'vet_convenio_eutanasia'

/**
 * GET /api/eutanasias/vets/datos-pago?token=...
 *
 * Endpoint público. Verifica el token de acción 'datos_pago' y devuelve los
 * datos actuales del vet para precargar el formulario (nombre, apellido,
 * email, rut, y los datos bancarios si ya los había completado antes).
 *
 * Por seguridad solo expone los datos del vet identificado en el token,
 * no de otros vets aunque el atacante adivine ids.
 */
export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get('token') || ''
  const verif = verifyToken(token)
  if (!verif.ok || !verif.payload) {
    return NextResponse.json({
      ok: false,
      error: verif.error === 'expired' ? 'El enlace ya expiró. Solicita uno nuevo escribiéndonos a info@crematorioalmaanimal.cl.' :
             verif.error === 'invalid_signature' ? 'Enlace inválido.' :
             'Enlace inválido o dañado.',
    }, { status: 400 })
  }
  if (verif.payload.accion !== 'datos_pago') {
    return NextResponse.json({ ok: false, error: 'Acción incorrecta para este enlace.' }, { status: 400 })
  }

  const vets = await getSheetData(SHEET)
  const v = vets.find(r => r.id === verif.payload!.vet_id)
  if (!v) return NextResponse.json({ ok: false, error: 'Veterinario no encontrado.' }, { status: 404 })

  return NextResponse.json({
    ok: true,
    vet: {
      id: v.id,
      nombre: v.nombre,
      apellido: v.apellido,
      email: v.email,
      rut: v.rut,
      banco: v.banco || '',
      tipo_cuenta: v.tipo_cuenta || '',
      numero_cuenta: v.numero_cuenta || '',
      datos_pago_completos: v.datos_pago_completos === 'TRUE',
      fecha_datos_pago: v.fecha_datos_pago || '',
    },
  })
}

/**
 * POST /api/eutanasias/vets/datos-pago
 * body: { token, nombre, rut, banco, tipo_cuenta, numero_cuenta, email }
 *
 * Endpoint público. Actualiza los datos bancarios del vet identificado en el
 * token. El email del form se usa solo como confirmación visual (queremos que
 * el vet vea su email para saber a quién está cargando los datos); el match
 * real es por el vet_id del token firmado.
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
    if (verif.payload.accion !== 'datos_pago') {
      return NextResponse.json({ ok: false, error: 'Acción incorrecta para este enlace.' }, { status: 400 })
    }

    const nombre = String(body.nombre ?? '').trim()
    const rut = String(body.rut ?? '').trim()
    const banco = String(body.banco ?? '').trim()
    const tipoCuenta = String(body.tipo_cuenta ?? '').trim()
    const numeroCuenta = String(body.numero_cuenta ?? '').replace(/\s+/g, '')
    const email = String(body.email ?? '').trim().toLowerCase()

    if (!nombre || nombre.length < 2) {
      return NextResponse.json({ ok: false, error: 'El nombre es obligatorio.' }, { status: 400 })
    }
    if (!rut || rut.length < 5) {
      return NextResponse.json({ ok: false, error: 'El RUT es obligatorio.' }, { status: 400 })
    }
    if (!banco || !bancoValido(banco)) {
      return NextResponse.json({ ok: false, error: 'Selecciona un banco válido.' }, { status: 400 })
    }
    if (!tipoCuenta || !tipoCuentaValido(tipoCuenta)) {
      return NextResponse.json({ ok: false, error: 'Selecciona un tipo de cuenta válido.' }, { status: 400 })
    }
    if (!numeroCuenta || !/^\d{4,}$/.test(numeroCuenta)) {
      return NextResponse.json({ ok: false, error: 'El número de cuenta debe ser numérico y tener al menos 4 dígitos.' }, { status: 400 })
    }
    if (!email || !/^[^\s,;<>"()@]+@[^\s,;<>"()@]+\.[^\s,;<>"()@]+$/i.test(email)) {
      return NextResponse.json({ ok: false, error: 'El email no es válido.' }, { status: 400 })
    }

    const vets = await getSheetData(SHEET)
    const idx = vets.findIndex(r => r.id === verif.payload!.vet_id)
    if (idx === -1) return NextResponse.json({ ok: false, error: 'Veterinario no encontrado.' }, { status: 404 })
    const v = vets[idx]

    // Si el email del form no coincide con el registrado, lo señalamos pero
    // permitimos actualizar (puede que el vet quiera cambiar su email también).
    const cambiaEmail = v.email && v.email.toLowerCase() !== email

    await updateRow(SHEET, idx, {
      ...v,
      nombre,
      rut,
      banco,
      tipo_cuenta: tipoCuenta,
      numero_cuenta: numeroCuenta,
      email,
      datos_pago_completos: 'TRUE',
      fecha_datos_pago: todayISO(),
    })

    return NextResponse.json({
      ok: true,
      email_cambio: cambiaEmail,
      mensaje: '¡Hemos recibido tus datos exitosamente! Los usaremos para transferirte los pagos al día hábil siguiente de cada servicio.',
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[eutanasias/datos-pago] error:', msg)
    return NextResponse.json({ ok: false, error: 'Error procesando tus datos.' }, { status: 500 })
  }
}
