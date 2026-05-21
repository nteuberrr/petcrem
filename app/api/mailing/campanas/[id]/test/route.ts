import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData } from '@/lib/google-sheets'
import { getFromR2 } from '@/lib/cloudflare-r2'
import { sendEmail, isResendConfigured } from '@/lib/resend-mailer'
import { renderForVet } from '@/lib/mailing-render'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if ((session?.user as { role?: string })?.role !== 'admin') {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  if (!isResendConfigured()) {
    return NextResponse.json({ error: 'RESEND_API_KEY no configurada' }, { status: 500 })
  }

  try {
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as { to?: string; sample_vet_id?: string }
    const to = (body.to || session?.user?.email || '').trim()
    if (!to) return NextResponse.json({ error: 'Falta destinatario de prueba (to)' }, { status: 400 })

    const rows = await getSheetData('mailing_campanas')
    const campana = rows.find(r => r.id === id)
    if (!campana) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })
    if (!campana.html_key) return NextResponse.json({ error: 'Campaña sin HTML' }, { status: 400 })

    const buf = await getFromR2(campana.html_key)
    if (!buf) return NextResponse.json({ error: 'HTML no encontrado en R2' }, { status: 404 })
    const htmlTemplate = buf.toString('utf8')

    // Vet de muestra: el indicado, o el primero activo, o uno fake
    const vets = await getSheetData('mailing_veterinarios')
    let sample = body.sample_vet_id ? vets.find(v => v.id === body.sample_vet_id) : null
    if (!sample) sample = vets.find(v => v.suscrito === 'TRUE') || vets[0]
    const sampleVet = sample ? {
      nombre: sample.nombre, email: sample.email, veterinaria: sample.veterinaria,
      comuna: sample.comuna, telefono: sample.telefono, categoria: sample.categoria,
    } : { nombre: 'Dr. Ejemplo Apellido', email: to, veterinaria: 'Clínica Demo', comuna: 'Santiago', telefono: '+56912345678', categoria: 'prospecto' }

    const html = renderForVet(htmlTemplate, sampleVet)
    const subject = `[TEST] ${campana.asunto}`

    const result = await sendEmail({
      to,
      subject,
      html,
      reply_to: campana.reply_to || undefined,
      preview_text: campana.preview_text || undefined,
      tags: [{ name: 'campana_id', value: String(id) }, { name: 'tipo', value: 'test' }],
      // En test no trackeamos (no hay log row para asociar). Útil ver el HTML sin
      // píxel ni links reescritos para previsualizar lo que realmente se manda.
    })
    if (!result.ok) return NextResponse.json({ error: result.error || 'Falló el envío' }, { status: 500 })
    return NextResponse.json({ ok: true, message_id: result.message_id, to, sample: sampleVet })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
