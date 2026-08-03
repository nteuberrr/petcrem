import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdmin } from '@/lib/roles'
import { uploadToR2 } from '@/lib/cloudflare-r2'
import { generarLocucion, isElevenLabsConfigurado, VOCES, VOZ_POR_DEFECTO } from '@/lib/elevenlabs'

// La síntesis de un guion de ~35 s tarda unos segundos; damos margen.
export const maxDuration = 60
export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!esAdmin((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  return null
}

/** GET — voces disponibles para el selector. */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  return NextResponse.json({
    configurado: isElevenLabsConfigurado(),
    voces: VOCES.map(v => ({ id: v.id, nombre: v.nombre, describe: v.describe })),
    por_defecto: VOZ_POR_DEFECTO,
  })
}

/**
 * POST { texto, voz? } — convierte el guion en locución.
 *
 * Devuelve la URL del MP3 en R2 y la marca de tiempo de cada palabra, que es lo
 * que el navegador usa para quemar los subtítulos sincronizados del video.
 */
export async function POST(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    if (!isElevenLabsConfigurado()) {
      return NextResponse.json({ error: 'Falta ELEVENLABS_API_KEY' }, { status: 500 })
    }
    const body = await req.json().catch(() => ({}))
    const texto = String(body.texto ?? '').trim()
    if (!texto) return NextResponse.json({ error: 'El guion está vacío' }, { status: 400 })

    const voz = VOCES.some(v => v.id === body.voz) ? String(body.voz) : VOZ_POR_DEFECTO
    const loc = await generarLocucion(texto, voz)

    // Se guarda en R2 para poder rearmar el video sin volver a pagar la síntesis.
    const key = `marketing/locuciones/${Date.now()}-${voz.slice(0, 8)}.mp3`
    const { url } = await uploadToR2(loc.mp3, key, 'audio/mpeg')

    return NextResponse.json({
      url,
      key,
      voz,
      duracion: loc.duracion,
      palabras: loc.palabras,
      caracteres: texto.length,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
