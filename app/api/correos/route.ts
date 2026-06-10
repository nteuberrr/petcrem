import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { getSheetData } from '@/lib/datastore'
import { getContacto } from '@/lib/email-layout'
import { sendEmail, isResendConfigured } from '@/lib/resend-mailer'
import { todayISO, formatDate } from '@/lib/dates'
import { listarCorreos, renderCorreo, type MuestraCorreo } from '@/lib/correos-catalogo'

// Catálogo de correos: previsualización + envío de prueba. Solo admin total
// (vive en Configuración Avanzada → Correos). Ver lib/roles APIS_AVANZADAS.

async function requireAdminTotal() {
  const session = await getServerSession(authOptions)
  if (!esAdminTotal((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo el administrador' }, { status: 403 })
  }
  return null
}

async function getEmailSeguimiento(): Promise<string> {
  try {
    const rows = await getSheetData('empresa_config')
    return (rows[0]?.email_seguimiento || '').trim()
  } catch { return '' }
}

/** Datos de muestra: el último cliente registrado (para que la prueba se vea real). */
async function construirMuestra(): Promise<MuestraCorreo> {
  let last: Record<string, string> | undefined
  try {
    const clientes = await getSheetData('clientes')
    last = clientes.filter(c => c.nombre_mascota).sort((a, b) => (parseInt(b.id, 10) || 0) - (parseInt(a.id, 10) || 0))[0]
  } catch { /* */ }
  let fechaCremacion = formatDate(todayISO())
  if (last?.ciclo_id) {
    try {
      const ciclos = await getSheetData('ciclos')
      const ci = ciclos.find(c => c.id === last!.ciclo_id)
      if (ci?.fecha) fechaCremacion = formatDate(ci.fecha)
    } catch { /* */ }
  }
  return {
    nombreMascota: last?.nombre_mascota || 'Mascota',
    nombreTutor: last?.nombre_tutor || 'Tutor',
    codigo: last?.codigo || 'X00-CI',
    email: last?.email || 'tutor@ejemplo.cl',
    fechaCremacion,
  }
}

export async function GET(req: NextRequest) {
  const denied = await requireAdminTotal()
  if (denied) return denied
  try {
    const key = new URL(req.url).searchParams.get('key')
    const [muestra, contacto] = await Promise.all([construirMuestra(), getContacto()])
    if (key) {
      const r = renderCorreo(key, muestra, contacto)
      if (!r) return NextResponse.json({ error: 'Correo no encontrado' }, { status: 404 })
      return NextResponse.json(r)
    }
    const seguimiento = await getEmailSeguimiento()
    return NextResponse.json({ correos: listarCorreos(), muestra, seguimiento })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireAdminTotal()
  if (denied) return denied
  try {
    if (!isResendConfigured()) {
      return NextResponse.json({ error: 'RESEND_API_KEY no configurada' }, { status: 500 })
    }
    const body = await req.json().catch(() => ({}))
    const key = String(body.key || '')
    const all = body.all === true
    const seguimiento = await getEmailSeguimiento()
    if (!seguimiento) {
      return NextResponse.json({ error: 'No hay correo de seguimiento configurado (defínelo más abajo en esta sección).' }, { status: 400 })
    }
    const [muestra, contacto] = await Promise.all([construirMuestra(), getContacto()])

    // Enviar TODO el catálogo: una copia de cada correo (con datos del último
    // cliente) al correo de seguimiento.
    if (all) {
      const lista = listarCorreos()
      let enviados = 0
      let fallidos = 0
      for (const def of lista) {
        const r = renderCorreo(def.key, muestra, contacto)
        if (!r) { fallidos++; continue }
        const res = await sendEmail({
          to: seguimiento,
          subject: `[PRUEBA] ${r.subject}`,
          html: r.html,
          preview_text: `Prueba del correo "${def.key}".`,
          tags: [{ name: 'tipo', value: 'correo_prueba' }],
        })
        if (res.ok) enviados++; else fallidos++
      }
      return NextResponse.json({ ok: true, all: true, enviados, fallidos, total: lista.length, to: seguimiento })
    }

    const r = renderCorreo(key, muestra, contacto)
    if (!r) return NextResponse.json({ error: 'Correo no encontrado' }, { status: 404 })

    const res = await sendEmail({
      to: seguimiento,
      subject: `[PRUEBA] ${r.subject}`,
      html: r.html,
      preview_text: `Prueba del correo "${key}".`,
      tags: [{ name: 'tipo', value: 'correo_prueba' }],
    })
    if (!res.ok) return NextResponse.json({ error: res.error ?? 'No se pudo enviar' }, { status: 502 })
    return NextResponse.json({ ok: true, to: seguimiento })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
