import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { pingCacheAgente } from '@/lib/agente-mensajes'
import { minutosDesdeUltimoUso } from '@/lib/uso-ia'
import { ahoraChile } from '@/lib/agenda'

/**
 * KEEP-ALIVE de la caché del prompt del bot.
 *
 * El prefijo del agente son ~25.000 tokens que se releen en cada respuesta.
 * Leerlos de caché cuesta $0,30/M; re-escribirlos, $6/M (2× la entrada, por el
 * TTL de 1 hora). Medido sobre 7 días de producción: la caché se caía 5,3 veces
 * al día en los huecos sin mensajes y cada caída costaba ~US$0,15 → US$23/mes,
 * el 27% de todo el gasto del bot. Una lectura la revive por US$0,008.
 *
 * Corre cada 15 minutos pero casi nunca hace nada: sale por una de las dos
 * guardas salvo que la caché esté por enfriarse de verdad.
 *
 * Auth: Bearer CRON_SECRET (lo manda Vercel) o sesión de admin total.
 * Ruta pública en proxy.ts, con esta auth interna.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Franja en que vale la pena mantenerla viva (hora de Chile). */
const DESDE_H = 8
const HASTA_H = 23
/**
 * Solo se pinguea si nadie tocó el prefijo en este rato. El TTL es de 60 min y
 * el cron corre cada 15, así que en el peor caso se dispara a los 55 min: queda
 * margen para que Vercel se atrase un poco sin dejar morir la caché.
 */
const MINUTOS_FRIA = 40

async function autorizado(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') || ''
    const a = crypto.createHash('sha256').update(auth).digest()
    const b = crypto.createHash('sha256').update(`Bearer ${secret}`).digest()
    if (crypto.timingSafeEqual(a, b)) return true
  }
  const session = await getServerSession(authOptions)
  return esAdminTotal((session?.user as { role?: string })?.role)
}

export async function GET(req: NextRequest) {
  if (!(await autorizado(req))) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  // ?forzar=1 saltea las guardas, para probar el ping a mano.
  const forzar = req.nextUrl.searchParams.get('forzar') === '1'

  // 1. De noche NO se mantiene viva: no hay mensajes que aprovechen la caché, y
  //    pagar lecturas hasta la mañana sale más caro que la única re-escritura
  //    que igual va a pagar el primer mensaje del día.
  const hora = ahoraChile().min / 60
  if (!forzar && (hora < DESDE_H || hora >= HASTA_H)) {
    return NextResponse.json({ ok: true, omitido: 'fuera de la franja de atención', hora: Math.floor(hora) })
  }

  // 2. Si una conversación real (o el ping anterior) tocó el prefijo hace poco,
  //    la caché ya está viva y este ping sería plata tirada: cada lectura renueva
  //    el TTL, así que el tráfico se mantiene solo.
  const min = await minutosDesdeUltimoUso('bot-inbox')
  if (!forzar && min !== null && min < MINUTOS_FRIA) {
    return NextResponse.json({ ok: true, omitido: 'la caché sigue caliente', minutosDesdeUltimoUso: Math.round(min) })
  }

  const r = await pingCacheAgente()
  if (!r.ok) {
    console.error('[cache-agente] ping falló:', r.error)
    return NextResponse.json({ ok: false, error: r.error }, { status: 500 })
  }
  // `leidos > 0` = el prefijo seguía vivo y le renovamos la hora (lo normal).
  // `escritos > 0` = ya había vencido y lo dejamos caliente para lo que viene.
  console.log(`[cache-agente] ping ok — leídos ${r.leidos}, escritos ${r.escritos}`)
  return NextResponse.json({
    ...r,
    minutosDesdeUltimoUso: min === null ? null : Math.round(min),
    resultado: r.leidos > 0 ? 'caché renovada' : 'caché reconstruida',
  })
}
