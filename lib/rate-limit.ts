import { NextRequest } from 'next/server'

/**
 * Rate limit por IP, en memoria, con ventana fija. Pensado para las rutas
 * PÚBLICAS (sin sesión): inscripción de vets, registro público de mascotas y
 * los proxies a Google Places (facturan por request).
 *
 * Limitación conocida: en Vercel el contador vive por instancia de lambda, así
 * que el límite efectivo es "por IP y por instancia" — suficiente contra loops
 * ingenuos y spam de formularios, no contra un ataque distribuido. Si algún día
 * hace falta un límite duro, mover el contador a Supabase/Upstash.
 */

type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()
const MAX_BUCKETS = 5000 // tope de memoria: ante overflow se limpia lo vencido

function clientIp(req: NextRequest): string {
  // Vercel setea x-forwarded-for con la IP real del cliente al frente.
  const fwd = req.headers.get('x-forwarded-for') || ''
  return fwd.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown'
}

/**
 * Devuelve true si la request queda DENTRO del límite (se permite), false si
 * se pasó. `key` separa contadores por endpoint; `max` requests por `ventanaMs`.
 */
export function permitirRequest(req: NextRequest, key: string, max: number, ventanaMs: number): boolean {
  const now = Date.now()
  const k = `${key}:${clientIp(req)}`
  const b = buckets.get(k)
  if (!b || b.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) {
      for (const [bk, bv] of buckets) { if (bv.resetAt <= now) buckets.delete(bk) }
      if (buckets.size >= MAX_BUCKETS) buckets.clear()
    }
    buckets.set(k, { count: 1, resetAt: now + ventanaMs })
    return true
  }
  b.count += 1
  return b.count <= max
}
