import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { ensureSheet, ensureColumns } from '@/lib/datastore'
import { SHEETS } from '@/lib/sheets-schema'

// El mapa canónico de hojas/columnas vive en lib/sheets-schema (lo comparten
// este endpoint y scripts/generar-schema-sql). Idempotente: si la hoja existe,
// solo agrega columnas faltantes.
// Ruta pública en proxy, pero la auth vive acá: sesión admin total O
// Authorization: Bearer <CRON_SECRET> (para bootstrap/automatización).
// Fail-closed: sin CRON_SECRET seteado, el Bearer no abre nada.

function bearerValido(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const auth = req.headers.get('authorization') || ''
  // sha256 de ambos lados para comparar timing-safe sin filtrar longitudes
  const a = crypto.createHash('sha256').update(auth).digest()
  const b = crypto.createHash('sha256').update(`Bearer ${secret}`).digest()
  return crypto.timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  if (!bearerValido(req)) {
    const session = await getServerSession(authOptions)
    if (!esAdminTotal((session?.user as { role?: string })?.role)) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }
  }

  const results: Array<{ hoja: string; ok: boolean; error?: string }> = []
  for (const [nombre, columnas] of Object.entries(SHEETS)) {
    try {
      await ensureSheet(nombre)
      await ensureColumns(nombre, columnas)
      results.push({ hoja: nombre, ok: true })
    } catch (e) {
      results.push({ hoja: nombre, ok: false, error: String(e) })
    }
  }
  const okCount = results.filter(r => r.ok).length
  return NextResponse.json({ ok: okCount === results.length, total: results.length, ok_count: okCount, results })
}

export async function GET(req: NextRequest) {
  return POST(req)
}
