import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdmin } from '@/lib/roles'
import { getFromR2, uploadToR2 } from '@/lib/cloudflare-r2'
import { CLIMAS, generarMusica, isElevenLabsConfigurado } from '@/lib/elevenlabs'

export const maxDuration = 120
export const dynamic = 'force-dynamic'

const BASE = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '')

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!esAdmin((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  return null
}

/** GET — climas musicales disponibles. */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  return NextResponse.json({
    configurado: isElevenLabsConfigurado(),
    climas: CLIMAS.map(c => ({ key: c.key, label: c.label, describe: c.describe })),
  })
}

/**
 * POST { clima, segundos, regenerar? } — cama musical para el video.
 *
 * Se guarda en R2 con una clave determinista (clima + duración) y se REUSA: así
 * el mismo clima suena igual en todas las piezas — que es lo que hace que una
 * marca se reconozca — y no se paga dos veces por lo mismo. Con `regenerar` se
 * fuerza una versión nueva si la que hay no convence.
 */
export async function POST(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    if (!isElevenLabsConfigurado()) {
      return NextResponse.json({ error: 'Falta ELEVENLABS_API_KEY' }, { status: 500 })
    }
    const body = await req.json().catch(() => ({}))
    const clima = CLIMAS.find(c => c.key === body.clima)
    if (!clima) return NextResponse.json({ error: 'Clima musical desconocido' }, { status: 400 })

    // Se redondea a tramos de 10 s para que piezas de duración parecida
    // compartan la misma cama en vez de generar una por segundo distinto.
    const segundos = Math.min(120, Math.max(10, Math.ceil((Number(body.segundos) || 30) / 10) * 10))
    const version = body.regenerar ? `-${Date.now().toString(36)}` : ''
    const key = `marketing/musica/${clima.key}-${segundos}s${version}.mp3`
    const url = `${BASE}/${key}`

    if (!body.regenerar) {
      const existente = await getFromR2(key).catch(() => null)
      if (existente) return NextResponse.json({ url, key, clima: clima.key, segundos, reusada: true })
    }

    const mp3 = await generarMusica(clima.prompt, segundos * 1000)
    await uploadToR2(mp3, key, 'audio/mpeg')
    return NextResponse.json({ url, key, clima: clima.key, segundos, reusada: false })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
