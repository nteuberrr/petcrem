import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, updateRow } from '@/lib/datastore'
import { verifyToken } from '@/lib/eutanasia-tokens'
import { bancoValido, tipoCuentaValido } from '@/lib/bancos-cl'
import { buscarComuna } from '@/lib/comunas'
import { capitalizarNombre } from '@/lib/nombres'
import { todayISO } from '@/lib/dates'
import { isWhatsappConfigured, avisarAdminsWhatsapp } from '@/lib/whatsapp'

const SHEET = 'vet_convenio_eutanasia'

/**
 * Autoservicio del veterinario de la red de eutanasias: ver y ACTUALIZAR su
 * ficha completa (contacto, comunas, días/horarios y datos de transferencia)
 * desde el link firmado que le envía el equipo con "Enviar datos a Vet".
 *
 * Sin sesión: el token HMAC ('editar_datos', 30 días) ES la autenticación y
 * ata la operación a UN vet_id — nunca se leen ni escriben datos de otro vet,
 * aunque se adivinen ids.
 *
 * Diferencia con /vets/datos-pago (consumo único, para el alta): éste SÍ deja
 * reescribir los datos bancarios, porque su razón de ser es mantener la ficha
 * al día. Como contrapartida, todo cambio de cuenta se avisa al admin por
 * WhatsApp con la cuenta enmascarada.
 *
 * Campos INTERNOS que el vet no puede tocar por esta vía: activo, origen,
 * notas, total_servicios, fechas del sistema.
 */

interface DiaHorario { am?: boolean; pm?: boolean }
const DIAS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'] as const

function validarEmail(s: string): boolean {
  return /^[^\s,;<>"()@]+@[^\s,;<>"()@]+\.[^\s,;<>"()@]+$/i.test(s.trim())
}

function normalizarComunas(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  const vistos = new Set<string>()
  for (const raw of input) {
    if (typeof raw !== 'string') continue
    const c = buscarComuna(raw)
    if (!c || vistos.has(c.nombre)) continue
    vistos.add(c.nombre)
    out.push(c.nombre)
  }
  return out
}

function normalizarHorarios(input: unknown): Record<string, DiaHorario> {
  if (!input || typeof input !== 'object') return {}
  const out: Record<string, DiaHorario> = {}
  for (const d of DIAS) {
    const v = (input as Record<string, unknown>)[d]
    if (v && typeof v === 'object') {
      const am = !!(v as DiaHorario).am
      const pm = !!(v as DiaHorario).pm
      if (am || pm) out[d] = { am, pm }
    }
  }
  return out
}

function parseArr(s: string | undefined): string[] {
  try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}
function parseObj(s: string | undefined): Record<string, DiaHorario> {
  try { const v = JSON.parse(s || '{}'); return v && typeof v === 'object' ? v : {} } catch { return {} }
}

/** Verifica el token y devuelve el vet + su índice de fila, o una respuesta de error. */
async function resolverVet(token: string) {
  const verif = verifyToken(token)
  if (!verif.ok || !verif.payload) {
    const error =
      verif.error === 'expired' ? 'Este enlace ya expiró. Escríbenos a info@crematorioalmaanimal.cl y te enviamos uno nuevo.' :
      verif.error === 'invalid_signature' ? 'Enlace inválido.' :
      'Enlace inválido o dañado.'
    return { error, status: 400 as const }
  }
  if (verif.payload.accion !== 'editar_datos') {
    return { error: 'Acción incorrecta para este enlace.', status: 400 as const }
  }
  const rows = await getSheetData(SHEET)
  const idx = rows.findIndex(r => r.id === verif.payload!.vet_id)
  if (idx === -1) return { error: 'Veterinario no encontrado.', status: 404 as const }
  return { vet: rows[idx], idx }
}

/**
 * GET /api/eutanasias/vets/mis-datos?token=...
 * Devuelve la ficha completa del vet del token para precargar el formulario.
 */
export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get('token') || ''
  const r = await resolverVet(token)
  if ('error' in r) return NextResponse.json({ ok: false, error: r.error }, { status: r.status })
  const v = r.vet

  return NextResponse.json({
    ok: true,
    vet: {
      id: v.id,
      nombre: v.nombre || '',
      apellido: v.apellido || '',
      email: v.email || '',
      telefono: v.telefono || '',
      rut: v.rut || '',
      comunas: parseArr(v.comunas),
      horarios: parseObj(v.horarios),
      banco: v.banco || '',
      tipo_cuenta: v.tipo_cuenta || '',
      numero_cuenta: v.numero_cuenta || '',
      datos_pago_completos: (v.datos_pago_completos || '').toUpperCase() === 'TRUE',
    },
  })
}

/**
 * POST /api/eutanasias/vets/mis-datos
 * body: { token, nombre, apellido, email, telefono, rut, comunas[], horarios{},
 *         banco?, tipo_cuenta?, numero_cuenta? }
 *
 * Guarda TODA la ficha de una vez. Los datos bancarios son opcionales (el vet
 * puede actualizar solo comunas/horarios), pero si envía uno tienen que venir
 * los tres y ser válidos: media cuenta bancaria no sirve para transferir.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const r = await resolverVet(String(body.token ?? ''))
    if ('error' in r) return NextResponse.json({ ok: false, error: r.error }, { status: r.status })
    const { vet: v, idx } = r

    const nombre = String(body.nombre ?? '').trim()
    const apellido = String(body.apellido ?? '').trim()
    const email = String(body.email ?? '').trim().toLowerCase()
    const telefono = String(body.telefono ?? '').replace(/\D/g, '').slice(-9)
    const rut = String(body.rut ?? '').trim()
    const comunas = normalizarComunas(body.comunas)
    const horarios = normalizarHorarios(body.horarios)
    const banco = String(body.banco ?? '').trim()
    const tipoCuenta = String(body.tipo_cuenta ?? '').trim()
    const numeroCuenta = String(body.numero_cuenta ?? '').replace(/\s+/g, '')

    if (!nombre || nombre.length < 2) return NextResponse.json({ ok: false, error: 'El nombre es obligatorio.' }, { status: 400 })
    if (!apellido || apellido.length < 2) return NextResponse.json({ ok: false, error: 'El apellido es obligatorio.' }, { status: 400 })
    if (!rut || rut.length < 5) return NextResponse.json({ ok: false, error: 'El RUT es obligatorio.' }, { status: 400 })
    if (!email || !validarEmail(email)) return NextResponse.json({ ok: false, error: 'El email no es válido.' }, { status: 400 })
    if (telefono.length !== 9) return NextResponse.json({ ok: false, error: 'El teléfono debe tener 9 dígitos (sin +56).' }, { status: 400 })
    if (comunas.length === 0) return NextResponse.json({ ok: false, error: 'Selecciona al menos una comuna donde atiendes.' }, { status: 400 })
    if (Object.keys(horarios).length === 0) return NextResponse.json({ ok: false, error: 'Selecciona al menos un día y horario de disponibilidad.' }, { status: 400 })

    // Bancarios: o los tres, o ninguno. Nunca una cuenta a medias.
    const algunBancario = !!(banco || tipoCuenta || numeroCuenta)
    if (algunBancario) {
      if (!bancoValido(banco)) return NextResponse.json({ ok: false, error: 'Selecciona un banco válido.' }, { status: 400 })
      if (!tipoCuentaValido(tipoCuenta)) return NextResponse.json({ ok: false, error: 'Selecciona un tipo de cuenta válido.' }, { status: 400 })
      if (!/^\d{4,}$/.test(numeroCuenta)) return NextResponse.json({ ok: false, error: 'El número de cuenta debe ser numérico y tener al menos 4 dígitos.' }, { status: 400 })
    }

    // ¿Cambió la cuenta de destino? Se avisa al admin (es el dato sensible).
    const cambioCuenta = algunBancario && (
      (v.banco || '') !== banco ||
      (v.tipo_cuenta || '') !== tipoCuenta ||
      (v.numero_cuenta || '') !== numeroCuenta
    )
    const cambioEmail = (v.email || '').toLowerCase() !== email

    await updateRow(SHEET, idx, {
      ...v,
      nombre: capitalizarNombre(nombre),
      apellido: capitalizarNombre(apellido),
      email,
      telefono,
      rut,
      comunas: JSON.stringify(comunas),
      horarios: JSON.stringify(horarios),
      // Si no mandó bancarios, se conservan los que ya estaban.
      ...(algunBancario ? {
        banco,
        tipo_cuenta: tipoCuenta,
        numero_cuenta: numeroCuenta,
        datos_pago_completos: 'TRUE',
        fecha_datos_pago: todayISO(),
      } : {}),
    })

    // Aviso al equipo (best-effort). El de cuenta bancaria es el que importa:
    // este link SÍ permite reescribirla, así que un cambio nunca pasa callado.
    if (isWhatsappConfigured()) {
      const nombreVet = `${capitalizarNombre(nombre)} ${capitalizarNombre(apellido)}`.trim()
      const aviso = cambioCuenta
        ? `💳 *Cambio de datos de transferencia* — red de eutanasias\n\n` +
          `${nombreVet} (${email}) actualizó su ficha desde su enlace.\n` +
          `Banco: ${banco} · ${tipoCuenta} · cuenta ${numeroCuenta.length > 4 ? `••••${numeroCuenta.slice(-4)}` : numeroCuenta}\n\n` +
          `Si no lo reconoces, revísalo en Servicios → Veterinarios.`
        : `📝 *Ficha actualizada* — red de eutanasias\n\n` +
          `${nombreVet} (${email}) actualizó sus datos.\n` +
          `Comunas: ${comunas.length} · Días con disponibilidad: ${Object.keys(horarios).length}`
      try { await avisarAdminsWhatsapp(aviso) } catch (e) { console.warn('[mis-datos] aviso admin falló:', e) }
    }

    return NextResponse.json({
      ok: true,
      email_cambio: cambioEmail,
      mensaje: 'Listo, tus datos quedaron actualizados en nuestro sistema. Desde ahora las solicitudes te llegarán según estas comunas y horarios.',
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[eutanasias/mis-datos] error:', msg)
    return NextResponse.json({ ok: false, error: 'Error guardando tus datos.' }, { status: 500 })
  }
}
