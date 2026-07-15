import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdmin } from '@/lib/roles'
import { archivarConversacionesInactivas } from '@/lib/mensajes'
import { enviarSeguimientosPendientes } from '@/lib/seguimiento-leads'
import { vigilanciaGoogleAds } from '@/lib/gads-vigilancia'
import { pingHealthcheck } from '@/lib/healthcheck'

/**
 * Cron diario de mantenimiento (Vercel; Hobby permite solo 2 crons → aquí se encadena
 * todo lo diario). Hace tres cosas, en orden:
 *  1) SEGUIMIENTO: escribe a los leads tibios (cotizaron y no cerraron) que
 *     siguen dentro de la ventana de 24h — antes de archivar, para no perderlos.
 *  2) ARCHIVAR: mueve a 'archivado' las conversaciones ACTIVAS de WhatsApp con
 *     más de 2 días sin actividad. Las de negocio (cliente/cerrado) o vets no se tocan.
 *  3) VIGILANCIA GOOGLE ADS (lib/gads-vigilancia): guardia diaria silenciosa (solo
 *     avisa al ADMIN_WHATSAPP si hay algo urgente) + informe semanal los lunes.
 * Corre en horario hábil de Chile para que los mensajes salgan a buena hora.
 * Auth: Bearer CRON_SECRET (Vercel) o sesión admin.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function autorizado(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') || ''
    const a = crypto.createHash('sha256').update(auth).digest()
    const b = crypto.createHash('sha256').update(`Bearer ${secret}`).digest()
    if (crypto.timingSafeEqual(a, b)) return true
  }
  const session = await getServerSession(authOptions)
  return esAdmin((session?.user as { role?: string })?.role)
}

export async function GET(req: NextRequest) {
  if (!(await autorizado(req))) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  try {
    // 1) Seguimiento a leads tibios ANTES de archivar (best-effort: no debe
    //    impedir el archivado si algo falla).
    let seguimiento = null
    try { seguimiento = await enviarSeguimientosPendientes() } catch (e) { console.error('[cron-archivar] seguimiento', e) }
    // 2) Archivar inactivas.
    const n = await archivarConversacionesInactivas(2)
    // 3) Vigilancia de Google Ads (guardia diaria + informe los lunes). Best-effort.
    let vigilancia = null
    try { vigilancia = await vigilanciaGoogleAds() } catch (e) { console.error('[cron-archivar] vigilancia gads', e) }
    await pingHealthcheck('HEALTHCHECK_URL_ARCHIVAR')
    return NextResponse.json({ ok: true, archivadas: n, seguimiento, vigilancia })
  } catch (e) {
    console.error('[cron-archivar]', e)
    await pingHealthcheck('HEALTHCHECK_URL_ARCHIVAR', { fail: true })
    return NextResponse.json({ error: 'Error al archivar' }, { status: 500 })
  }
}
