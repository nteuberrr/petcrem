import { NextRequest, NextResponse, after } from 'next/server'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase'

/**
 * GET /api/mailing/click/[campana]/[vet]?u=<encoded-target-url>
 * Cuando el destinatario clickea un link reescrito, primero pasa por acá:
 * registramos el click y redirigimos al destino original.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ campana: string; vet: string }> }) {
  const { campana, vet } = await params
  const target = req.nextUrl.searchParams.get('u')
  if (!target) return NextResponse.json({ error: 'falta param u' }, { status: 400 })

  let urlDestino = ''
  try {
    urlDestino = decodeURIComponent(target)
    // Validar que sea http(s) — anti SSRF / open-redirect
    if (!/^https?:\/\//i.test(urlDestino)) {
      return NextResponse.json({ error: 'URL inválida' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'URL no decodificable' }, { status: 400 })
  }

  // Registrar el click en after() (garantiza ejecución tras la redirección).
  // Solo mailing_logs; los contadores los agrega on-demand /api/mailing/campanas.
  after(async () => {
    if (!isSupabaseConfigured()) return
    try {
      const supabase = getSupabase()
      const ahora = new Date().toISOString()
      const { data: existing, error: selErr } = await supabase
        .from('mailing_logs')
        .select('id, fecha_click')
        .eq('campana_id', campana)
        .eq('vet_id', vet)
        .limit(1)
      if (selErr) { console.error('[click] select:', selErr.message); return }
      const log = existing?.[0]
      if (!log) return

      const updates: Record<string, string> = { url_clickeada: urlDestino }
      // Solo marcar fecha_click la primera vez (1 click por destinatario en agregado)
      if (!log.fecha_click) {
        updates.fecha_click = ahora
        updates.estado = 'clicked'
      }

      const { error: updErr } = await supabase.from('mailing_logs').update(updates).eq('id', log.id)
      if (updErr) { console.error('[click] update:', updErr.message); return }
    } catch (err) {
      console.error('[click] error:', err)
    }
  })

  return NextResponse.redirect(urlDestino, 302)
}
