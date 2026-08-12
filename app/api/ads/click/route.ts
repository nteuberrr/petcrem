import { NextRequest, NextResponse } from 'next/server'
import { registrarClick } from '@/lib/ads-clicks'

/**
 * Registra un clic de anuncio (Google o Meta) que aterrizó en el sitio público y
 * devuelve el código corto que el navegador incrusta en el link de WhatsApp.
 *
 * PÚBLICO (lo llama el visitante, sin sesión) — está en la lista blanca de
 * proxy.ts junto a /api/web-vitals. No expone nada: solo escribe.
 *
 * Nunca devuelve error al navegador: si la medición falla, el visitante no tiene
 * por qué enterarse ni ver un error en consola.
 */
export const dynamic = 'force-dynamic'

const MAX = 512

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as
      { gclid?: unknown; gbraid?: unknown; wbraid?: unknown; fbclid?: unknown; landing?: unknown } | null
    if (!body) return NextResponse.json({ codigo: null })

    const limpio = (v: unknown): string | null => {
      const s = typeof v === 'string' ? v.trim() : ''
      // Los identificadores de Google son alfanuméricos con - y _; los de Meta
      // (fbclid) además pueden traer . y los signos del base64 url-safe.
      return s && s.length <= MAX && /^[\w.-]+$/.test(s) ? s : null
    }

    const codigo = await registrarClick({
      gclid: limpio(body.gclid),
      gbraid: limpio(body.gbraid),
      wbraid: limpio(body.wbraid),
      fbclid: limpio(body.fbclid),
      landing: typeof body.landing === 'string' ? body.landing.slice(0, 300) : null,
    })
    return NextResponse.json({ codigo }, { headers: { 'cache-control': 'no-store' } })
  } catch (e) {
    console.warn('[api/ads/click]', e instanceof Error ? e.message : e)
    return NextResponse.json({ codigo: null })
  }
}
