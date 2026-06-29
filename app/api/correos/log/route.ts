import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { listarCorreoLog, obtenerCorreoLog } from '@/lib/correos-audit'
import { sendEmail, isResendConfigured } from '@/lib/resend-mailer'

const EMAIL_RE = /^[^\s,;<>"()@]+@[^\s,;<>"()@]+\.[^\s,;<>"()@]+$/i

// Registro/respaldo de correos transaccionales enviados. Solo admin total
// (Configuración Avanzada → Correos). GET ?id= devuelve el correo completo
// (con html) para el visor; sin id devuelve la lista paginada/filtrada.
// POST { id, to } reenvía ese correo (mismo asunto + cuerpo) a otra dirección.

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!esAdminTotal((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo el administrador' }, { status: 403 })
  }
  try {
    const sp = new URL(req.url).searchParams
    const id = sp.get('id')
    if (id) {
      const row = await obtenerCorreoLog(id)
      if (!row) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
      return NextResponse.json(row)
    }
    const res = await listarCorreoLog({
      desde: sp.get('desde') || undefined,
      hasta: sp.get('hasta') || undefined,
      q: sp.get('q') || undefined,
      page: parseInt(sp.get('page') || '1', 10) || 1,
      pageSize: parseInt(sp.get('pageSize') || '10', 10) || 10,
    })
    return NextResponse.json(res)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

/**
 * POST { id, to } — reenvía un correo ya enviado (mismo asunto + cuerpo guardado)
 * a otra dirección, ingresada a mano. Pasa `seguimiento` → re-registra el reenvío
 * en correos_log y aplica el BCC de seguimiento por tipo (si está activo, te llega
 * copia igual que en el envío original).
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!esAdminTotal((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo el administrador' }, { status: 403 })
  }
  if (!isResendConfigured()) {
    return NextResponse.json({ error: 'El envío de correos no está configurado (falta RESEND_API_KEY).' }, { status: 400 })
  }
  try {
    const body = (await req.json().catch(() => ({}))) as { id?: string; to?: string }
    const id = String(body.id || '').trim()
    const to = String(body.to || '').trim()
    if (!id) return NextResponse.json({ error: 'Falta el id del correo.' }, { status: 400 })
    if (!EMAIL_RE.test(to)) return NextResponse.json({ error: 'Correo de destino inválido.' }, { status: 400 })

    const row = await obtenerCorreoLog(id)
    if (!row) return NextResponse.json({ error: 'Correo no encontrado.' }, { status: 404 })
    if (!row.html?.trim()) return NextResponse.json({ error: 'Este correo no guardó su cuerpo; no se puede reenviar.' }, { status: 400 })

    const audiencia = row.audiencia === 'Tutor' || row.audiencia === 'Veterinario' ? row.audiencia : undefined
    const res = await sendEmail({
      to,
      subject: row.asunto || '(sin asunto)',
      html: row.html,
      seguimiento: {
        tipo: row.tipo || 'reenvio',
        audiencia,
        codigo: row.codigo || undefined,
        nombre: row.nombre || undefined,
        clienteId: row.cliente_id || undefined,
      },
    })
    if (!res.ok) return NextResponse.json({ error: res.error || 'No se pudo reenviar el correo.' }, { status: 502 })
    return NextResponse.json({ ok: true, to, message_id: res.message_id })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
