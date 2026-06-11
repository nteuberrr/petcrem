import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase'
import { getSheetData } from '@/lib/datastore'
import { esAdmin } from '@/lib/roles'

/**
 * GET /api/mailing/debug?campana_id=X
 *
 * Devuelve un snapshot del estado real del mailing para diagnosticar
 * por qué los contadores de aperturas/clicks pueden no estar avanzando.
 *
 * Incluye:
 * - estado de env vars relevantes
 * - últimos N mailing_logs (con resend_message_id, estado, fechas)
 * - distribución por estado de la campaña pedida (o de todos si no se pasa)
 * - últimos eventos de webhook (si Supabase guarda esa info)
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!esAdmin((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }

  const url = new URL(req.url)
  const campanaId = url.searchParams.get('campana_id') || ''
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 200)

  const env = {
    own_tracking_disabled: (process.env.MAILING_DISABLE_OWN_TRACKING ?? '').toLowerCase() === 'true',
    webhook_permissive: (process.env.MAILING_WEBHOOK_PERMISSIVE ?? '').toLowerCase() === 'true',
    public_app_url: process.env.PUBLIC_APP_URL || process.env.NEXTAUTH_URL || null,
    webhook_secret_set: !!process.env.RESEND_WEBHOOK_SECRET,
    webhook_secret_prefix: process.env.RESEND_WEBHOOK_SECRET
      ? process.env.RESEND_WEBHOOK_SECRET.slice(0, 6) + '…' + process.env.RESEND_WEBHOOK_SECRET.slice(-4)
      : null,
    from_email: process.env.MAILING_FROM_EMAIL || '(sin configurar)',
    resend_key_set: !!process.env.RESEND_API_KEY,
    supabase_configured: isSupabaseConfigured(),
    supabase_alive: null as boolean | null,
    supabase_error: null as string | null,
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ env, error: 'Supabase no configurado, no se pueden leer logs' })
  }

  const supabase = getSupabase()

  // Test real de conexión: consulta liviana. Si esto falla, el proyecto está
  // pausado (free tier de Supabase pausa tras 1 semana de inactividad) o las
  // credenciales son incorrectas.
  try {
    const probe = await supabase.from('mailing_logs').select('id', { count: 'exact', head: true }).limit(1)
    env.supabase_alive = !probe.error
    if (probe.error) env.supabase_error = probe.error.message
  } catch (e) {
    env.supabase_alive = false
    env.supabase_error = e instanceof Error ? e.message : String(e)
  }
  if (env.supabase_alive === false) {
    return NextResponse.json({
      env,
      error: `Supabase NO responde: ${env.supabase_error}. Posibles causas: proyecto pausado (free tier pausa tras 1 semana), URL/anon key incorrectas, o proyecto eliminado. Ir a https://supabase.com/dashboard y reanudarlo si está pausado.`,
    })
  }

  // Query base: últimos N logs (filtrados por campaña si viene id)
  let q = supabase
    .from('mailing_logs')
    .select('id, campana_id, vet_email, resend_message_id, estado, fecha_envio, fecha_entrega, fecha_apertura, fecha_click, fecha_rebote, error_msg')
    .order('id', { ascending: false })
    .limit(limit)
  if (campanaId) q = q.eq('campana_id', campanaId)

  const { data: logs, error: logsErr } = await q
  if (logsErr) {
    return NextResponse.json({ env, error: `Error leyendo logs: ${logsErr.message}` })
  }

  // Distribución por estado para la campaña pedida
  let distribucion: Record<string, number> = {}
  if (campanaId) {
    const { data: counts, error: countErr } = await supabase
      .from('mailing_logs')
      .select('estado')
      .eq('campana_id', campanaId)
    if (!countErr && counts) {
      for (const r of counts) {
        const e = r.estado || '(null)'
        distribucion[e] = (distribucion[e] || 0) + 1
      }
    }
  }

  // Contadores: dos versiones para comparar.
  // - planilla: lo que está crudo en mailing_campanas (puede estar desactualizado)
  // - reales: calculados acá desde mailing_logs en este momento
  let contadoresPlanilla: Record<string, unknown> | null = null
  let contadoresReales: Record<string, unknown> | null = null
  if (campanaId) {
    try {
      const rows = await getSheetData('mailing_campanas')
      const c = rows.find(r => r.id === campanaId)
      if (c) {
        contadoresPlanilla = {
          enviados: c.enviados, entregados: c.entregados,
          aperturas: c.aperturas, clicks: c.clicks,
          rebotes: c.rebotes, spam: c.spam, fallidos: c.fallidos,
          estado: c.estado,
        }
      }
    } catch (e) {
      contadoresPlanilla = { error: String(e) }
    }
    // Reales: agregación rápida sobre TODOS los logs (no solo los 50 que muestra la tabla)
    try {
      const { data: allLogs, error: aggErr } = await supabase
        .from('mailing_logs')
        .select('estado, fecha_envio, fecha_entrega, fecha_apertura, fecha_click, fecha_rebote')
        .eq('campana_id', campanaId)
      if (!aggErr && allLogs) {
        let enviados = 0, entregados = 0, aperturas = 0, clicks = 0, rebotes = 0, spam = 0, fallidos = 0
        for (const l of allLogs) {
          if (l.fecha_envio) enviados++
          if (l.fecha_entrega) entregados++
          if (l.fecha_apertura) aperturas++
          if (l.fecha_click) clicks++
          if (l.fecha_rebote) rebotes++
          if (l.estado === 'complained') spam++
          if (l.estado === 'failed') fallidos++
        }
        contadoresReales = { enviados, entregados, aperturas, clicks, rebotes, spam, fallidos, total_logs: allLogs.length }
      }
    } catch (e) {
      contadoresReales = { error: String(e) }
    }
  }

  return NextResponse.json({
    env,
    campana_id: campanaId || null,
    contadores_planilla: contadoresPlanilla,
    contadores_reales: contadoresReales,
    distribucion_logs: distribucion,
    logs,
    interpretacion: interpretar(env, logs ?? [], distribucion),
  })
}

interface LogRow {
  estado?: string | null
  fecha_entrega?: string | null
  fecha_apertura?: string | null
  fecha_click?: string | null
}

function interpretar(
  env: { own_tracking_disabled: boolean; public_app_url: string | null; webhook_secret_set: boolean },
  logs: LogRow[],
  distribucion: Record<string, number>,
): string[] {
  const out: string[] = []
  if (logs.length === 0) {
    out.push('No hay logs en mailing_logs. Posible: la campaña todavía no se envió, o el insert en Supabase falló.')
    return out
  }
  const totalConFechaEntrega = logs.filter(l => l.fecha_entrega).length
  const totalConFechaApertura = logs.filter(l => l.fecha_apertura).length
  const totalConFechaClick = logs.filter(l => l.fecha_click).length

  out.push(`Total logs revisados: ${logs.length}`)
  out.push(`Con fecha_entrega: ${totalConFechaEntrega}`)
  out.push(`Con fecha_apertura: ${totalConFechaApertura}`)
  out.push(`Con fecha_click: ${totalConFechaClick}`)
  out.push(`Distribución por estado: ${JSON.stringify(distribucion)}`)

  if (totalConFechaEntrega === 0 && logs.length > 0) {
    out.push('⚠ Ninguno con fecha_entrega. El webhook email.delivered no está llegando o no está actualizando el log.')
  }
  if (totalConFechaApertura === 0 && totalConFechaEntrega > 0) {
    out.push('⚠ Hubo entregas pero ninguna apertura registrada. Posibles causas:')
    out.push('   1. El destinatario no abrió o no cargó las imágenes (Gmail bloquea por default).')
    out.push('   2. Open tracking está apagado en Resend (Domain → Configuration).')
    out.push('   3. Webhook recibe email.opened pero falla al actualizar.')
  }
  if (!env.own_tracking_disabled) {
    out.push('⚠ MAILING_DISABLE_OWN_TRACKING NO está en true. Si tienes Resend tracking activo, los links están siendo reescritos dos veces.')
  }
  if (!env.webhook_secret_set) {
    out.push('⚠ RESEND_WEBHOOK_SECRET no configurado. El webhook acepta sin verificar firma (OK en dev, no recomendado en prod).')
  }
  return out
}
