import { NextRequest, NextResponse, after } from 'next/server'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase'

// 1x1 transparent GIF — el byte payload mínimo posible (43 bytes)
const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
)

/**
 * GET /api/mailing/pixel/[campana]/[vet]
 * El píxel 1x1 invisible incrustado en cada email. Cuando el cliente de email
 * (Gmail, Outlook) carga las imágenes, este endpoint registra la apertura.
 *
 * Cuerpo: GIF transparente de 43 bytes (mínimo absoluto).
 * Side-effect: UPDATE mailing_logs SET fecha_apertura=NOW(), estado='opened'
 *   WHERE campana_id=X AND vet_id=Y AND fecha_apertura IS NULL (idempotente).
 * Los contadores de mailing_campanas NO se tocan acá: los calcula on-demand
 * /api/mailing/campanas agregando mailing_logs (evita lost-update + cuota Sheets).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ campana: string; vet: string }> }) {
  const { campana, vet } = await params

  // Devolvemos el GIF SIEMPRE — registrar la apertura es side-effect best-effort.
  // No esperamos a que termine la query.
  const pixel = new NextResponse(new Uint8Array(TRANSPARENT_GIF), {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': String(TRANSPARENT_GIF.length),
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
    },
  })

  // Registrar apertura en after() — garantiza que corra tras enviar la respuesta
  // (un IIFE detached lo mata Vercel al congelar la función). Solo mailing_logs.
  after(async () => {
    if (!isSupabaseConfigured()) return
    try {
      const supabase = getSupabase()
      const ahora = new Date().toISOString()

      // Buscar el log; solo update si fecha_apertura es null (primera apertura única)
      const { data: existing, error: selErr } = await supabase
        .from('mailing_logs')
        .select('id, fecha_apertura')
        .eq('campana_id', campana)
        .eq('vet_id', vet)
        .limit(1)
      if (selErr) { console.error('[pixel] select:', selErr.message); return }
      const log = existing?.[0]
      if (!log) return  // Sin log, posiblemente test o campaña borrada
      if (log.fecha_apertura) return  // ya registrado, no contamos doble

      const { error: updErr } = await supabase
        .from('mailing_logs')
        .update({ fecha_apertura: ahora, estado: 'opened' })
        .eq('id', log.id)
      if (updErr) { console.error('[pixel] update:', updErr.message); return }
    } catch (err) {
      console.error('[pixel] error:', err)
    }
  })

  return pixel
}
