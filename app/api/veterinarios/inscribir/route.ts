import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, appendRow, getNextId } from '@/lib/datastore'
import { todayISO } from '@/lib/dates'
import { buscarComuna } from '@/lib/comunas'
import { capitalizarNombre } from '@/lib/nombres'
import { permitirRequest } from '@/lib/rate-limit'
import { enviarBienvenidaConvenioVet } from '@/lib/vet-cremacion-mailer'
import { isWhatsappConfigured, avisarAdminsWhatsapp } from '@/lib/whatsapp'
import { sincronizarMailingCliente } from '@/lib/mailing-vet-sync'

/**
 * POST /api/veterinarios/inscribir — AUTOINSCRIPCIÓN pública de veterinarias al
 * convenio de CREMACIÓN (hoja `veterinarios`, la misma ficha que crea el admin
 * en /bases). La llama el landing /convenio-veterinarias, sin sesión.
 *
 * Política (decisión del dueño 2026-07-04): auto-aprobada con
 * tipo_precios='precios_convenio' (tarifas de convenio) y activo=TRUE.
 * Anti-abuso: honeypot 'website' + rate limit por IP. Idempotencia: si ya
 * existe una veterinaria con el mismo correo o RUT, no se duplica.
 */
export async function POST(req: NextRequest) {
  try {
    if (!permitirRequest(req, 'veterinarios-inscribir', 5, 60 * 60_000)) {
      return NextResponse.json({ error: 'Demasiados intentos. Intenta más tarde.' }, { status: 429 })
    }
    const body = await req.json().catch(() => ({}))

    // Honeypot: los bots llenan todos los campos. OK silencioso, sin insertar.
    if (body.website && String(body.website).trim() !== '') {
      return NextResponse.json({ ok: true, mensaje: 'Recibido' })
    }

    const nombre = capitalizarNombre(String(body.nombre ?? '').trim())
    const rut = String(body.rut ?? '').trim()
    const razonSocial = String(body.razon_social ?? '').trim()
    const giro = String(body.giro ?? '').trim()
    const direccion = String(body.direccion ?? '').trim()
    const comunaInput = String(body.comuna ?? '').trim()
    const telefono = String(body.telefono ?? '').replace(/\D/g, '').slice(-9)
    const correo = String(body.correo ?? '').trim().toLowerCase()
    const nombreContacto = capitalizarNombre(String(body.nombre_contacto ?? '').trim())
    const cargoContacto = String(body.cargo_contacto ?? '').trim()

    if (!nombre || nombre.length < 3) {
      return NextResponse.json({ error: 'El nombre de la clínica/veterinaria es obligatorio.' }, { status: 400 })
    }
    if (!rut || rut.length < 5) {
      return NextResponse.json({ error: 'El RUT es obligatorio.' }, { status: 400 })
    }
    if (!correo || !/^[^\s,;<>"()@]+@[^\s,;<>"()@]+\.[^\s,;<>"()@]+$/i.test(correo)) {
      return NextResponse.json({ error: 'El correo no es válido.' }, { status: 400 })
    }
    if (telefono.length !== 9) {
      return NextResponse.json({ error: 'El teléfono debe tener 9 dígitos (sin +56).' }, { status: 400 })
    }
    if (!direccion || direccion.length < 5) {
      return NextResponse.json({ error: 'La dirección es obligatoria.' }, { status: 400 })
    }
    const comuna = buscarComuna(comunaInput)?.nombre || ''
    if (!comuna) {
      return NextResponse.json({ error: 'Selecciona una comuna válida.' }, { status: 400 })
    }
    if (!nombreContacto || nombreContacto.length < 3) {
      return NextResponse.json({ error: 'El nombre de la persona de contacto es obligatorio.' }, { status: 400 })
    }

    // Idempotencia: no duplicar por correo ni por RUT.
    const rutNorm = rut.replace(/[.\s-]/g, '').toLowerCase()
    const rows = await getSheetData('veterinarios')
    const existente = rows.find(r =>
      (r.correo || '').trim().toLowerCase() === correo ||
      (r.rut || '').replace(/[.\s-]/g, '').toLowerCase() === rutNorm)
    if (existente) {
      return NextResponse.json({
        ok: true,
        ya_inscrito: true,
        mensaje: 'Esta veterinaria ya está registrada en nuestro convenio. Si necesitas actualizar sus datos, escríbenos a contacto@crematorioalmaanimal.cl.',
      })
    }

    const id = await getNextId('veterinarios')
    const row = {
      id,
      nombre,
      rut,
      razon_social: razonSocial,
      giro,
      direccion,
      comuna,
      telefono,
      correo,
      nombre_contacto: nombreContacto,
      cargo_contacto: cargoContacto,
      // Autoinscripción → SIEMPRE tarifas de convenio (decisión del dueño).
      tipo_precios: 'precios_convenio',
      precios_especiales: '',
      activo: 'TRUE',
      fecha_creacion: todayISO(),
    }
    await appendRow('veterinarios', row)

    // Regla automática: todo vet del convenio queda como CLIENTE en la base de
    // Mailing (upsert por email; best-effort).
    await sincronizarMailingCliente({
      correo, nombre, nombre_contacto: nombreContacto, comuna, telefono,
    })

    // Bienvenida al convenio (mismo correo que el alta manual). Se espera el
    // envío (serverless mata promesas pendientes al return); si falla no aborta.
    try {
      await enviarBienvenidaConvenioVet({
        email: correo,
        vetNombre: nombre,
        contacto: nombreContacto,
        cargoContacto,
        razonSocial,
        rut,
        giro,
        direccion,
        comuna,
        telefono,
      })
    } catch (e) {
      console.warn('[veterinarios/inscribir] fallo mail bienvenida (no bloqueante):', e)
    }

    // Aviso al equipo por WhatsApp (regla del proyecto: todo al wp). Best-effort.
    if (isWhatsappConfigured()) {
      try {
        await avisarAdminsWhatsapp(
          `🩺 *Nueva veterinaria inscrita al convenio de cremación*\n\n` +
          `${nombre}\nRUT: ${rut}\nComuna: ${comuna}\n` +
          `Contacto: ${nombreContacto}${cargoContacto ? ` (${cargoContacto})` : ''}\n` +
          `Tel: +56 ${telefono} · ${correo}\n\n` +
          `Quedó ACTIVA con tarifas de convenio. Revisa su ficha en Bases.`,
        )
      } catch (e) {
        console.warn('[veterinarios/inscribir] aviso admin falló:', e)
      }
    }

    return NextResponse.json({
      ok: true,
      id,
      mensaje: '¡Bienvenidos al convenio! Ya pueden agendar retiros con nosotros — les enviamos un correo con los datos del convenio.',
    }, { status: 201 })
  } catch (e) {
    console.error('[veterinarios/inscribir] error:', e)
    return NextResponse.json({ error: 'Error al procesar la inscripción. Intenta de nuevo.' }, { status: 500 })
  }
}
