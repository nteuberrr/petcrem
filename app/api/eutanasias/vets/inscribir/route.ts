import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, appendRow, getNextId, ensureSheet, ensureColumns } from '@/lib/datastore'
import { todayISO } from '@/lib/dates'
import { buscarComuna } from '@/lib/comunas'
import { enviarBienvenidaVet } from '@/lib/eutanasia-mailer'
import { capitalizarNombre } from '@/lib/nombres'

const SHEET = 'vet_convenio_eutanasia'
const COLS = [
  'id', 'nombre', 'apellido', 'email', 'telefono', 'rut',
  'comunas', 'horarios',
  'activo', 'origen', 'notas',
  'total_servicios',
  'fecha_inscripcion', 'fecha_creacion',
]

function validarEmail(s: string): boolean {
  return /^[^\s,;<>"()@]+@[^\s,;<>"()@]+\.[^\s,;<>"()@]+$/i.test(s.trim())
}

function normalizarTelefono(s: string): string {
  // Quita todo lo que no sea dígito; toma últimos 9 (formato chileno).
  const soloDigitos = String(s).replace(/\D/g, '')
  return soloDigitos.slice(-9)
}

function normalizarComunas(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  const vistos = new Set<string>()
  for (const raw of input) {
    if (typeof raw !== 'string') continue
    const c = buscarComuna(raw)
    if (!c) continue
    if (vistos.has(c.nombre)) continue
    vistos.add(c.nombre)
    out.push(c.nombre)
  }
  return out
}

interface DiaHorario { am?: boolean; pm?: boolean }
function normalizarHorarios(input: unknown): Record<string, DiaHorario> {
  if (!input || typeof input !== 'object') return {}
  const dias = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom']
  const out: Record<string, DiaHorario> = {}
  for (const d of dias) {
    const v = (input as Record<string, unknown>)[d]
    if (v && typeof v === 'object') {
      const dia = v as { am?: unknown; pm?: unknown }
      const am = !!dia.am
      const pm = !!dia.pm
      if (am || pm) out[d] = { am, pm }
    }
  }
  return out
}

/**
 * POST /api/eutanasias/vets/inscribir
 *
 * Endpoint público (sin auth) para que los veterinarios se inscriban al
 * convenio desde /convenio-eutanasias.
 *
 * Anti-abuso: campo honeypot 'website' debe llegar vacío. Si el cliente lo
 * llena (lo que pasa con bots), respondemos 200 OK para no dar pistas pero
 * no insertamos nada.
 *
 * Política: auto-aprobado. Inserta con activo=TRUE directamente.
 * Idempotencia: si ya existe un vet con el mismo email, devolvemos 200
 * sin insertar (mensaje informativo).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))

    // Honeypot: bots típicamente llenan TODOS los campos. Si este viene con
    // algo, asumimos bot y respondemos OK silencioso sin tocar la base.
    if (body.website && String(body.website).trim() !== '') {
      return NextResponse.json({ ok: true, mensaje: 'Recibido' })
    }

    // Validaciones de campos requeridos
    const nombre = String(body.nombre ?? '').trim()
    const apellido = String(body.apellido ?? '').trim()
    const email = String(body.email ?? '').trim().toLowerCase()
    const telefono = normalizarTelefono(String(body.telefono ?? ''))
    const rut = String(body.rut ?? '').trim()
    const comunas = normalizarComunas(body.comunas)
    const horarios = normalizarHorarios(body.horarios)

    if (!nombre || nombre.length < 2) {
      return NextResponse.json({ error: 'El nombre es obligatorio.' }, { status: 400 })
    }
    if (!apellido || apellido.length < 2) {
      return NextResponse.json({ error: 'El apellido es obligatorio.' }, { status: 400 })
    }
    if (!rut || rut.length < 5) {
      return NextResponse.json({ error: 'El RUT es obligatorio.' }, { status: 400 })
    }
    if (!email || !validarEmail(email)) {
      return NextResponse.json({ error: 'El email no es válido.' }, { status: 400 })
    }
    if (telefono.length !== 9) {
      return NextResponse.json({ error: 'El teléfono debe tener 9 dígitos (sin +56).' }, { status: 400 })
    }
    if (comunas.length === 0) {
      return NextResponse.json({ error: 'Selecciona al menos una comuna donde atiendes.' }, { status: 400 })
    }
    if (Object.keys(horarios).length === 0) {
      return NextResponse.json({ error: 'Selecciona al menos un día y horario de disponibilidad.' }, { status: 400 })
    }

    // Nombre/apellido en Tipo Título (se usan en los correos al vet).
    const nombreCap = capitalizarNombre(nombre)
    const apellidoCap = capitalizarNombre(apellido)

    await ensureSheet(SHEET)
    await ensureColumns(SHEET, COLS)

    // Idempotencia: si ya existe con ese email, no duplicar
    const rows = await getSheetData(SHEET)
    const existente = rows.find(r => (r.email ?? '').toLowerCase() === email)
    if (existente) {
      return NextResponse.json({
        ok: true,
        ya_inscrito: true,
        mensaje: 'Tu email ya está registrado en el convenio. Si quieres actualizar tus datos, escríbenos a info@crematorioalmaanimal.cl.',
      })
    }

    const id = await getNextId(SHEET)
    const hoy = todayISO()
    const row = {
      id,
      nombre: nombreCap,
      apellido: apellidoCap,
      email,
      telefono,
      rut,
      comunas: JSON.stringify(comunas),
      horarios: JSON.stringify(horarios),
      activo: 'TRUE',
      origen: 'publico',
      notas: String(body.notas ?? '').trim(),
      total_servicios: '0',
      fecha_inscripcion: hoy,
      fecha_creacion: hoy,
    }
    await appendRow(SHEET, row)

    // Mail de bienvenida — esperamos el envío porque en serverless el handler
    // termina al return y mata el promise pendiente. Si falla, no abortamos
    // la inscripción (la fila ya quedó), pero loggeamos el detalle.
    const bienvenida = await enviarBienvenidaVet({ vetId: id, nombre: nombreCap, apellido: apellidoCap, email })

    return NextResponse.json({
      ok: true,
      id,
      bienvenida_estado: bienvenida.estado,
      bienvenida_error: bienvenida.error,
      bienvenida_from: bienvenida.from_used,
      bienvenida_to: bienvenida.to,
      mensaje: '¡Bienvenido a la comunidad! Nos pondremos en contacto contigo cuando llegue una solicitud que coincida con tus comunas y horarios.',
    }, { status: 201 })
  } catch (e) {
    console.error('[inscribir vet eutanasia] error:', e)
    return NextResponse.json({ error: 'Error al procesar la inscripción. Intenta de nuevo.' }, { status: 500 })
  }
}
